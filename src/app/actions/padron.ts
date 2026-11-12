"use server";

import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getSession } from "@/app/actions/auth";
import { normalizeWatchCat } from "@/lib/watch-categories";
import { aplicarListaNegraEnCamaras, normalizarMatricula, type ResultadoCamaras } from "@/lib/lista-negra";
import {
    COMPORTAMIENTO_DEFECTO, NIVELES, SETTING_COMPORTAMIENTO, SIN_IDENTIFICAR, normalizarComportamiento, proximaRevision,
    type Comportamiento, type NivelListaNegra,
} from "@/lib/padron";
import { anotar, claveDeFila, dondeDeClave, mudarBitacora, tieneBitacora } from "@/lib/lista-amarilla";

/**
 * Las acciones del padrón: la pestaña Lista negra (fichas) y los interruptores de cada pestaña.
 *
 * La lista negra sigue siendo UNA tabla, PlateWatch, que es lo que leen la barrera
 * (lib/lista-negra → estaEnListaNegra, y su espejo en server.js), las lectoras y el bot. Lo
 * nuevo es la ficha: varias filas con el mismo `ficha` son una persona o un vehículo. Por eso
 * nada de esto toca server.js ni cambia qué se deniega: una ficha con tres matrículas son tres
 * filas, exactamente como si se hubieran cargado de a una.
 *
 * Las fichas NO son usuarios ni credenciales. Cargar a alguien en lista negra como usuario le
 * daba una credencial de matrícula, y una credencial es lo que abre la barrera.
 */

const PAGINAS = ["/admin/users", "/admin/monitor-lpr", "/admin/history"];
const revalidar = () => PAGINAS.forEach((p) => revalidatePath(p));
const norm = normalizarMatricula;

async function quienSoy(): Promise<string | null> {
    try { const s: any = await getSession(); return (s?.name as string) || (s?.sub as string) || null; } catch { return null; }
}
async function exigirSesion() {
    if (!(await getSession().catch(() => null))) throw new Error("Sesión vencida: volvé a entrar.");
}
const juntar = (a: ResultadoCamaras, b?: ResultadoCamaras) => { if (b) { a.ok.push(...b.ok); a.fallo.push(...b.fallo); } };

// ── Fichas ────────────────────────────────────────────────────────────────────────────────

/**
 * De dónde sale una ficha. La clave lo lleva adelante para que guardar y dar de baja sepan qué
 * filas tocar sin volver a adivinar:
 *   f:<id>      una ficha de la pestaña (filas con ese `ficha`)
 *   p:<filaId>  una matrícula suelta, cargada desde el monitor o el bot
 *   u:<userId>  una persona del padrón marcada desde su cajón (arrastra sus matrículas)
 *   r:<userId>  una persona con el rol «Lista negra» del módulo facial (sólo lectura)
 */
export type OrigenFicha = "ficha" | "suelta" | "persona" | "rol";

export type FichaListaNegra = {
    clave: string;
    origen: OrigenFicha;
    /** Vacío = sin identificar. */
    nombre: string;
    nivel: NivelListaNegra;
    motivo: string | null;
    fotoUrl: string | null;
    activa: boolean;
    matriculas: string[];
    desde: string | null;
    bajaEn: string | null;
    cargo: string | null;
    /** La persona del padrón, cuando la ficha es de una persona marcada. */
    userId: string | null;
    unidad: string | null;
    /** La última vez que alguna lectora leyó alguna de sus matrículas. */
    vistaUltima: string | null;
    vecesVista: number;
    /** Lista Amarilla: cuándo toca revisarla (la más próxima de sus matrículas). Null en lista negra. */
    revisarEl: string | null;
    /** Lecturas de los últimos 7 días, sumando sus matrículas. */
    vistas7: number;
};

type Fila = Awaited<ReturnType<typeof prisma.plateWatch.findMany>>[number];

const claveDe = (f: Fila): string => claveDeFila(f);

/** Qué filas son de una ficha, según su clave. */
const dondeDe = (clave: string): any | null => dondeDeClave(clave);

const nivelDe = (cats: (string | null)[]): NivelListaNegra =>
    cats.some((c) => normalizeWatchCat(c) === "BLACKLISTED") ? "BLACKLISTED" : "SEARCH";

/** La revisión de una ficha: la más próxima de sus matrículas (deberían coincidir). Null si alguna no tiene. */
function revisionDe(filas: Fila[]): string | null {
    if (!filas.length || filas.some((f) => !f.revisarEl)) return null;
    return new Date(Math.min(...filas.map((f) => f.revisarEl!.getTime()))).toISOString();
}

export async function getFichasListaNegra(): Promise<FichaListaNegra[]> {
    const todas = await prisma.plateWatch.findMany({ orderBy: { updatedAt: "desc" } });
    // Sólo los dos niveles de la lista negra. Una matrícula VIP suelta (de antes) sigue valiendo
    // en el monitor, pero no es lista negra.
    const filas = todas.filter((f) => { const c = normalizeWatchCat(f.category); return c === "BLACKLISTED" || c === "SEARCH"; });

    const grupos = new Map<string, Fila[]>();
    for (const f of filas) { const k = claveDe(f); grupos.set(k, [...(grupos.get(k) || []), f]); }

    const idsPersonas = [...new Set(filas.map((f) => f.userId).filter(Boolean))] as string[];
    const [personas, porRol] = await Promise.all([
        idsPersonas.length ? prisma.user.findMany({ where: { id: { in: idsPersonas } }, select: { id: true, name: true, cara: true, unit: { select: { name: true } } } }) : [],
        prisma.user.findMany({
            where: { role: "BLACKLISTED" as any },
            select: { id: true, name: true, cara: true, blacklistReason: true, createdAt: true, unit: { select: { name: true } }, credentials: { where: { type: "PLATE" }, select: { value: true } } },
        }),
    ]);
    const persona = new Map(personas.map((p) => [p.id, p]));

    const out: FichaListaNegra[] = [];
    for (const [clave, fs] of grupos) {
        const activas = fs.filter((f) => f.active);
        // Inactiva: las matrículas de la última baja (las que se habían quitado antes no vuelven).
        const ultimaBaja = Math.max(0, ...fs.map((f) => f.deactivatedAt?.getTime() || 0));
        const vigentes = activas.length ? activas : fs.filter((f) => (f.deactivatedAt?.getTime() || 0) === ultimaBaja);
        const cabeza = vigentes[0] || fs[0];
        const p = cabeza.userId ? persona.get(cabeza.userId) : undefined;
        const origen: OrigenFicha = clave.startsWith("f:") ? "ficha" : clave.startsWith("u:") ? "persona" : "suelta";
        out.push({
            clave, origen,
            nombre: origen === "persona" ? (p?.name || cabeza.label) : cabeza.label,
            nivel: nivelDe(vigentes.map((f) => f.category)),
            motivo: cabeza.motivo || null,
            fotoUrl: cabeza.fotoUrl || (p?.cara ? (p.cara.startsWith("http") || p.cara.startsWith("/") ? p.cara : "/" + p.cara) : null),
            activa: activas.length > 0,
            matriculas: [...new Set(vigentes.map((f) => norm(f.plate)).filter(Boolean))],
            desde: new Date(Math.min(...vigentes.map((f) => f.createdAt.getTime()))).toISOString(),
            bajaEn: activas.length ? null : (ultimaBaja ? new Date(ultimaBaja).toISOString() : null),
            cargo: cabeza.createdBy || null,
            userId: cabeza.userId || null,
            unidad: p?.unit?.name || null,
            vistaUltima: null, vecesVista: 0, vistas7: 0,
            revisarEl: activas.length && nivelDe(vigentes.map((f) => f.category)) === "SEARCH" ? revisionDe(activas) : null,
        });
    }
    // Las del módulo facial: personas con el rol «Lista negra», con o sin fila propia.
    for (const u of porRol) {
        const chapas = [...new Set(u.credentials.map((c) => norm(c.value)).filter(Boolean))];
        if (out.some((f) => f.userId === u.id && f.activa)) continue;
        out.push({
            clave: `r:${u.id}`, origen: "rol", nombre: u.name, nivel: "BLACKLISTED", motivo: u.blacklistReason || null,
            fotoUrl: u.cara ? (u.cara.startsWith("http") || u.cara.startsWith("/") ? u.cara : "/" + u.cara) : null,
            activa: true, matriculas: chapas, desde: u.createdAt.toISOString(), bajaEn: null, cargo: null,
            userId: u.id, unidad: u.unit?.name || null, vistaUltima: null, vecesVista: 0, vistas7: 0, revisarEl: null,
        });
    }

    // Cuándo se la vio por última vez: la pregunta que se hace quien abre la lista.
    const chapas = [...new Set(out.flatMap((f) => f.matriculas))];
    if (chapas.length) {
        try {
            const vistas = await prisma.accessEvent.groupBy({ by: ["plateDetected"], where: { plateDetected: { in: chapas } }, _max: { timestamp: true }, _count: { _all: true } });
            const porChapa = new Map(vistas.map((v) => [v.plateDetected, v]));
            for (const f of out) {
                for (const m of f.matriculas) {
                    const v = porChapa.get(m);
                    if (!v) continue;
                    f.vecesVista += v._count._all;
                    const t = v._max.timestamp?.toISOString() || null;
                    if (t && (!f.vistaUltima || t > f.vistaUltima)) f.vistaUltima = t;
                }
            }
        } catch { /* sin la última vista la lista se muestra igual */ }
        // Lista Amarilla: lecturas de la última semana, la misma cuenta que lleva el aviso
        // (lecturas de matrícula, sin las «sin vehículo»).
        const amarillas = [...new Set(out.filter((f) => f.nivel === "SEARCH" && f.activa).flatMap((f) => f.matriculas))];
        if (amarillas.length) {
            try {
                const semana = await prisma.accessEvent.groupBy({
                    by: ["plateDetected"], _count: { _all: true },
                    where: { plateDetected: { in: amarillas }, accessType: "PLATE", sinVehiculo: false, timestamp: { gte: new Date(Date.now() - 7 * 86_400_000) } },
                });
                const n = new Map(semana.map((v) => [v.plateDetected, v._count._all]));
                for (const f of out) if (f.nivel === "SEARCH") for (const m of f.matriculas) f.vistas7 += n.get(m) || 0;
            } catch { /* igual que arriba: la tabla se muestra sin la cuenta */ }
        }
    }

    // Activas primero, y adentro las de alerta máxima; después lo más reciente.
    return out.sort((a, b) => Number(b.activa) - Number(a.activa)
        || Number(b.nivel === "BLACKLISTED") - Number(a.nivel === "BLACKLISTED")
        || (b.desde || "").localeCompare(a.desde || ""));
}

export type ResultadoFicha = {
    ok: boolean;
    clave?: string;
    error?: string;
    /** Cosas que el operador tiene que confirmar antes de guardar (se vuelve a llamar con `confirmar`). */
    avisos?: string[];
    camaras?: ResultadoCamaras;
};

/**
 * Crear o editar una ficha. Por cada matrícula, una fila de PlateWatch con el mismo `ficha`;
 * las que se sacan de la ficha se desactivan (no se borran). Toda matrícula que entra o sale
 * de alerta máxima se aplica en las lectoras en el momento, y se devuelve qué pasó.
 */
export async function guardarFichaListaNegra(datos: {
    clave?: string | null; nombre: string; nivel: NivelListaNegra; motivo: string;
    matriculas: string[]; fotoUrl?: string | null; confirmar?: boolean;
}): Promise<ResultadoFicha> {
    try {
        await exigirSesion();
        const nivel = normalizeWatchCat(datos.nivel);
        if (nivel !== "BLACKLISTED" && nivel !== "SEARCH") return { ok: false, error: "Nivel desconocido." };
        const chapas = [...new Set((datos.matriculas || []).map(norm).filter(Boolean))];
        if (!chapas.length) return { ok: false, error: "Falta al menos una matrícula: es lo que leen las cámaras." };
        const motivo = (datos.motivo || "").trim();
        // Lista Amarilla el motivo ES el aviso: lo que el guardia lee en la captura.
        if (nivel === "SEARCH" && !motivo) return { ok: false, error: "Lista Amarilla hace falta el motivo: es lo que el guardia lee en la captura." };
        const nombre = (datos.nombre || "").trim();

        const clave = datos.clave || null;
        if (clave && (clave.startsWith("u:") || clave.startsWith("r:")))
            return { ok: false, error: "Es una persona del padrón: se edita desde su ficha de persona." };
        const id = clave?.startsWith("f:") ? clave.slice(2) : randomUUID();
        const dondeAntes = clave ? dondeDe(clave) : null;
        const antes = dondeAntes ? await prisma.plateWatch.findMany({ where: dondeAntes }) : [];
        const idsAntes = new Set(antes.map((f) => f.id));

        // Lo que hay que confirmar: matrículas de otra ficha, y matrículas de gente del padrón
        // (a alguien con credencial, alerta máxima le cierra la barrera).
        const previas = await prisma.plateWatch.findMany({ where: { plate: { in: chapas } } });
        const avisos: string[] = [];
        for (const f of previas) {
            if (!f.active || idsAntes.has(f.id)) continue;
            const c = normalizeWatchCat(f.category);
            const otra = c === "WHITELISTED" ? "VIP" : `«${f.label || SIN_IDENTIFICAR}» (${c ? NIVELES[c as NivelListaNegra]?.corto || c : "otra categoría"})`;
            avisos.push(`${norm(f.plate)} ya está en ${otra}: se pasa a esta ficha.`);
        }
        if (nivel === "BLACKLISTED") {
            const creds = await prisma.credential.findMany({
                where: { type: "PLATE", value: { in: chapas }, user: { role: { not: "BLACKLISTED" as any } } },
                select: { value: true, user: { select: { name: true } } },
            });
            for (const c of creds) avisos.push(`${norm(c.value)} es de ${c.user?.name || "alguien del padrón"}: desde ahora la barrera le deniega el paso.`);
        }
        if (avisos.length && !datos.confirmar) return { ok: false, avisos };

        const yo = await quienSoy();
        const camaras: ResultadoCamaras = { ok: [], fallo: [] };
        const porChapa = new Map(previas.map((f) => [norm(f.plate), f]));
        // Lista Amarilla: la revisión es de la FICHA, igual en todas sus matrículas. Editar una
        // amarilla no la renueva (para eso está «Renovar»); un alta, o venir de la negra, arranca
        // el plazo. En alerta máxima no hay revisión.
        const activasAntes = antes.filter((f) => f.active);
        const nivelAntes: NivelListaNegra | null = activasAntes.length ? nivelDe(activasAntes.map((f) => f.category)) : null;
        const revisarEl = nivel !== "SEARCH" ? null
            : nivelAntes === "SEARCH" && revisionDe(activasAntes) ? new Date(revisionDe(activasAntes)!) : proximaRevision();
        for (const p of chapas) {
            const prev = porChapa.get(p);
            const eraNegra = !!prev?.active && normalizeWatchCat(prev.category) === "BLACKLISTED";
            const mismaFicha = !!prev && idsAntes.has(prev.id);
            const comunes = {
                label: nombre, category: nivel, motivo: motivo || null, ficha: id, active: true, deactivatedAt: null, revisarEl,
                notify: prev?.notify ?? true,
                // «Quién la cargó» es de quien la puso en esta ficha, no del último que la editó.
                createdBy: mismaFicha && prev?.active ? (prev.createdBy || yo) : yo,
                ...(datos.fotoUrl !== undefined ? { fotoUrl: datos.fotoUrl } : {}),
            };
            await prisma.plateWatch.upsert({ where: { plate: prev?.plate || p }, create: { plate: p, ...comunes }, update: comunes });
            if (eraNegra !== (nivel === "BLACKLISTED")) juntar(camaras, await aplicarListaNegraEnCamaras(p, nivel === "BLACKLISTED"));
        }
        // Las que se sacaron de la ficha: inactivas, y fuera de la lista negra de las lectoras.
        const quedan = new Set(chapas);
        for (const f of antes) {
            if (!f.active || quedan.has(norm(f.plate))) continue;
            await prisma.plateWatch.update({ where: { id: f.id }, data: { active: false, deactivatedAt: new Date() } });
            if (normalizeWatchCat(f.category) === "BLACKLISTED") juntar(camaras, await aplicarListaNegraEnCamaras(f.plate, false));
        }
        // La bitácora. Una matrícula suelta (p:<fila>) guardada desde acá se vuelve ficha y cambia
        // de clave: sus asientos se mudan con ella ANTES de anotar nada nuevo. No va en una
        // transacción con las filas porque entre medio se habla con las lectoras, y una
        // transacción abierta esperando a una cámara es como se agotan las conexiones.
        const claveNueva = `f:${id}`;
        if (clave && clave !== claveNueva) await mudarBitacora(clave, claveNueva);
        if (!nivelAntes && nivel === "SEARCH") await anotar(claveNueva, "ALTA", `Alta en la Lista Amarilla: ${motivo}`, yo);
        else if (nivelAntes === "SEARCH" && nivel === "BLACKLISTED") await anotar(claveNueva, "NIVEL", "Pasó a lista negra (alerta máxima).", yo);
        else if (nivelAntes === "BLACKLISTED" && nivel === "SEARCH") await anotar(claveNueva, "NIVEL", `Pasó de lista negra a la Lista Amarilla: ${motivo}`, yo);
        revalidar();
        return { ok: true, clave: claveNueva, camaras };
    } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
}

/** Dar de baja una ficha entera: todas sus matrículas a la vez, con la misma hora (así se reactivan juntas). */
export async function bajaFichaListaNegra(clave: string): Promise<ResultadoFicha> {
    try {
        await exigirSesion();
        if (clave.startsWith("r:")) return { ok: false, error: "Está en lista negra por su rol (módulo facial): se saca cambiándole el rol en su ficha de persona." };
        const donde = dondeDe(clave);
        if (!donde) return { ok: false, error: "Ficha desconocida." };
        const filas = await prisma.plateWatch.findMany({ where: { ...donde, active: true } });
        const ahora = new Date();
        const camaras: ResultadoCamaras = { ok: [], fallo: [] };
        for (const f of filas) {
            await prisma.plateWatch.update({ where: { id: f.id }, data: { active: false, deactivatedAt: ahora } });
            if (normalizeWatchCat(f.category) === "BLACKLISTED") juntar(camaras, await aplicarListaNegraEnCamaras(f.plate, false));
        }
        // Se anota si es amarilla, o si lo fue (ya tiene bitácora): la historia sigue aunque cambie de nivel.
        if (filas.length && (filas.some((f) => normalizeWatchCat(f.category) === "SEARCH") || await tieneBitacora(clave))) await anotar(clave, "BAJA", "Dada de baja.", await quienSoy());
        revalidar();
        return { ok: true, clave, camaras };
    } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
}

/** Volver a activar: las matrículas de la última baja, con el mismo nivel y motivo. */
export async function reactivarFichaListaNegra(clave: string, confirmar = false): Promise<ResultadoFicha> {
    try {
        await exigirSesion();
        const donde = dondeDe(clave);
        if (!donde) return { ok: false, error: "Ficha desconocida." };
        const filas = await prisma.plateWatch.findMany({ where: { ...donde, active: false } });
        const ultima = Math.max(0, ...filas.map((f) => f.deactivatedAt?.getTime() || 0));
        const vuelven = filas.filter((f) => (f.deactivatedAt?.getTime() || 0) === ultima);
        if (!vuelven.length) return { ok: false, error: "No hay matrículas para reactivar." };
        if (!confirmar) {
            const enUso = vuelven.length ? await prisma.plateWatch.findMany({ where: { plate: { in: vuelven.map((f) => f.plate) }, active: true } }) : [];
            if (enUso.length) return { ok: false, avisos: enUso.map((f) => `${f.plate} está activa en otra entrada.`) };
        }
        const camaras: ResultadoCamaras = { ok: [], fallo: [] };
        // Una amarilla que vuelve arranca el plazo de revisión de nuevo: reactivarla ES haberla mirado.
        const revisarEl = proximaRevision();
        for (const f of vuelven) {
            const amarilla = normalizeWatchCat(f.category) === "SEARCH";
            await prisma.plateWatch.update({ where: { id: f.id }, data: { active: true, deactivatedAt: null, revisarEl: amarilla ? revisarEl : null } });
            if (normalizeWatchCat(f.category) === "BLACKLISTED") juntar(camaras, await aplicarListaNegraEnCamaras(f.plate, true));
        }
        if (vuelven.some((f) => normalizeWatchCat(f.category) === "SEARCH") || await tieneBitacora(clave)) await anotar(clave, "REACTIVACION", "Activa otra vez.", await quienSoy());
        revalidar();
        return { ok: true, clave, camaras };
    } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
}

// ── Comportamiento de cada pestaña ────────────────────────────────────────────────────────

export async function getComportamientoPadron(): Promise<Comportamiento> {
    try {
        const row = await prisma.setting.findUnique({ where: { key: SETTING_COMPORTAMIENTO } });
        return normalizarComportamiento(row ? JSON.parse(row.value) : COMPORTAMIENTO_DEFECTO);
    } catch { return normalizarComportamiento(COMPORTAMIENTO_DEFECTO); }
}

export async function guardarComportamientoPadron(c: Comportamiento): Promise<{ ok: boolean; error?: string; valor?: Comportamiento }> {
    try {
        await exigirSesion();
        const valor = normalizarComportamiento(c);
        await prisma.setting.upsert({ where: { key: SETTING_COMPORTAMIENTO }, create: { key: SETTING_COMPORTAMIENTO, value: JSON.stringify(valor) }, update: { value: JSON.stringify(valor) } });
        revalidatePath("/admin/monitor-lpr");
        return { ok: true, valor };
    } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
}

/**
 * Quién se entera cuando pasa algo de la lista negra fuera de las pantallas: las reglas de
 * Notificaciones que escuchan WATCHLIST. Se MUESTRA, no se dibuja como interruptor: el aviso
 * por WhatsApp o Telegram se configura en esas reglas (a quién, por qué canal, en qué
 * horario), y un interruptor acá que no las tocara mentiría.
 */
export async function getAvisosListaNegra(): Promise<{ activas: number; total: number; canales: string[] }> {
    try {
        const reglas = await prisma.notificationRule.findMany({ where: { eventos: { contains: "WATCHLIST" } }, select: { enabled: true, channels: true } });
        const activas = reglas.filter((r) => r.enabled);
        const canales = [...new Set(activas.flatMap((r) => (r.channels || "").split(",").map((s) => s.trim()).filter(Boolean)))];
        return { activas: activas.length, total: reglas.length, canales };
    } catch { return { activas: 0, total: 0, canales: [] }; }
}
