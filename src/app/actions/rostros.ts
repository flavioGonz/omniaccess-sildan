"use server";

import { GetObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { getS3Client } from "@/lib/s3";
import { getCompreFace } from "@/lib/compareface";
import {
    codigoRostro, nombreCamara, FRECUENTE_DESDE, ROSTROS_POR_PAGINA, PASADAS_EN_FICHA,
    type FilaRostro, type FichaRostro, type FiltroRostro, type OrdenRostro,
} from "@/lib/rostros";

/*
 * Las identidades por rostro, del lado del panel (13/11, Nico: «el modo face debe guardar el
 * rostro detectado y asignarle un id, compararlo para saber cuántas veces pasa, poder
 * registrarlo»). Las crea y las cuenta el proceso de visión (vision-rostros.js); acá se miran, se
 * les pone nombre, se unen cuando el motor partió a una persona en dos, y se olvidan.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const R = require("../../../lib-rostros.js") as { idDeSujeto: (s: string) => string | null; VISITA_MS: number; EJEMPLOS_MAX: number; UMBRAL_MISMA: number; UMBRAL_PARECIDA: number; CARA_PX_MIN: number; ANONIMOS_DIAS: number };

const BUCKET = process.env.VISION_BUCKET || "objetos";
const imagen = (clave: string | null | undefined) => (clave ? `/api/vision/imagen/${clave}` : null);

async function sesionCon(...permisos: string[]) {
    const { getSession } = await import("@/app/actions/auth");
    const { permisosDeSesion } = await import("@/lib/permisos");
    const s: any = await getSession().catch(() => null);
    const tiene = s ? permisosDeSesion(s) : [];
    if (!s || !permisos.some((p) => tiene.includes(p))) throw new Error("Tu rol no puede hacer esto con los rostros.");
    return s;
}
const VER = ["vision", "rostros"] as const;
const CAMBIAR = ["vision.config", "rostros.listas"] as const;

async function auditar(s: any, accion: string, objetivo: string, detalle?: string) {
    await prisma.accionSistema.create({ data: { quien: String(s?.name || s?.sub || "panel"), accion, objetivo, ok: true, detalle: detalle ? detalle.slice(0, 500) : null } }).catch(() => { });
}

/* ── El motor ──────────────────────────────────────────────────────────────────── */

async function motor(ruta: string, op: { metodo?: string; jpeg?: Buffer } = {}): Promise<{ ok: boolean; estado: number }> {
    const { url, recoKey } = await getCompreFace();
    const init: RequestInit = { method: op.metodo || "POST", headers: { "x-api-key": recoKey }, signal: AbortSignal.timeout(12_000) };
    if (op.jpeg) { const fd = new FormData(); fd.append("file", new Blob([new Uint8Array(op.jpeg)]), "f.jpg"); init.body = fd; }
    const r = await fetch(`${url}${ruta}`, init);
    return { ok: r.ok, estado: r.status };
}
const olvidarSujeto = (sujeto: string) => motor(`/api/v1/recognition/subjects/${encodeURIComponent(sujeto)}`, { metodo: "DELETE" }).catch(() => null);

async function bajar(clave: string): Promise<Buffer | null> {
    try { const r = await (await getS3Client()).send(new GetObjectCommand({ Bucket: BUCKET, Key: clave })); return Buffer.from(await r.Body!.transformToByteArray()); }
    catch { return null; }
}
async function borrar(claves: (string | null)[]) {
    const objetos = claves.filter(Boolean).map((Key) => ({ Key: Key as string }));
    for (let i = 0; i < objetos.length; i += 1000) await (await getS3Client()).send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: objetos.slice(i, i + 1000), Quiet: true } })).catch(() => null);
}

/* ── Leer ──────────────────────────────────────────────────────────────────────── */

type Crudo = { id: string; numero: number; sujeto: string; userId: string | null; apodo: string | null; foto: string | null; calidad: number; veces: number; primeraVez: Date; ultimaVez: Date; ultimaCamara: string | null; parecidaA: string | null; parecido: number | null; ejemplos: number };

async function aFilas(crudos: Crudo[]): Promise<FilaRostro[]> {
    const ids = [...new Set(crudos.map((r) => r.userId).filter(Boolean) as string[])];
    const parecidas = [...new Set(crudos.map((r) => r.parecidaA).filter(Boolean) as string[])];
    const [personas, otras] = await Promise.all([
        ids.length ? prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, role: true, cara: true } }) : [],
        parecidas.length ? prisma.rostro.findMany({ where: { id: { in: parecidas } }, select: { id: true, numero: true, apodo: true, foto: true, userId: true } }) : [],
    ]);
    const porId = new Map(personas.map((u) => [u.id, u]));
    const otraPorId = new Map(otras.map((o) => [o.id, o]));
    return crudos.map((r) => {
        // La persona pudo borrarse del padrón después: la identidad vuelve a ser anónima.
        const u = r.userId ? porId.get(r.userId) : null;
        const o = r.parecidaA ? otraPorId.get(r.parecidaA) : null;
        return {
            id: r.id, numero: r.numero, codigo: codigoRostro(r.numero),
            nombre: u?.name || r.apodo || null, registro: u ? "persona" : r.apodo ? "apodo" : null,
            userId: u?.id || null, rol: u ? String(u.role) : null,
            foto: imagen(r.foto), calidad: r.calidad,
            veces: r.veces, primeraVez: r.primeraVez.toISOString(), ultimaVez: r.ultimaVez.toISOString(), ultimaCamara: nombreCamara(r.ultimaCamara),
            sugerencia: o && r.parecido != null ? { id: o.id, codigo: codigoRostro(o.numero), nombre: o.apodo || null, foto: imagen(o.foto), parecido: r.parecido } : null,
        };
    });
}

export type ListaRostros = {
    rostros: FilaRostro[]; total: number;
    cuentas: Record<FiltroRostro, number>;
    /** Cómo está trabajando el modo face: lo que la pantalla tiene que decir cuando no hay nada. */
    motor: { prendido: boolean; camaras: number; umbralMisma: number; umbralParecida: number; pxMin: number; anonimosDias: number };
};

const FILTRO: Record<FiltroRostro, object> = {
    todos: {},
    "sin-registrar": { userId: null, apodo: null },
    registrados: { OR: [{ userId: { not: null } }, { apodo: { not: null } }] },
    frecuentes: { veces: { gte: FRECUENTE_DESDE } },
    sugerencias: { parecidaA: { not: null } },
};

export async function listarRostros(op: { filtro?: FiltroRostro; orden?: OrdenRostro; q?: string; pagina?: number } = {}): Promise<ListaRostros> {
    await sesionCon(...VER);
    const filtro = op.filtro && FILTRO[op.filtro] ? op.filtro : "todos";
    const q = String(op.q || "").trim();
    let busca: object = {};
    if (q) {
        const n = /^(?:r-?)?0*(\d{1,7})$/i.exec(q);
        if (n) busca = { numero: Number(n[1]) };
        else {
            const gente = await prisma.user.findMany({ where: { name: { contains: q, mode: "insensitive" } }, select: { id: true }, take: 200 });
            busca = { OR: [{ apodo: { contains: q, mode: "insensitive" } }, { userId: { in: gente.map((g) => g.id) } }] };
        }
    }
    const where = { AND: [FILTRO[filtro], busca] };
    const orderBy = op.orden === "veces" ? [{ veces: "desc" as const }, { ultimaVez: "desc" as const }] : op.orden === "nuevos" ? [{ primeraVez: "desc" as const }] : [{ ultimaVez: "desc" as const }];
    const pagina = Math.max(0, Math.trunc(Number(op.pagina) || 0));
    const leer = async (k: string) => (await prisma.setting.findUnique({ where: { key: k } }).catch(() => null))?.value ?? null;
    const num = (v: string | null, def: number) => (v != null && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : def);
    const [crudos, total, todos, sin, reg, frec, sug, mFace, fCams, uM, uP, px, dias] = await Promise.all([
        prisma.rostro.findMany({ where, orderBy, skip: pagina * ROSTROS_POR_PAGINA, take: ROSTROS_POR_PAGINA }),
        prisma.rostro.count({ where }),
        prisma.rostro.count(), prisma.rostro.count({ where: FILTRO["sin-registrar"] }), prisma.rostro.count({ where: FILTRO.registrados }),
        prisma.rostro.count({ where: FILTRO.frecuentes }), prisma.rostro.count({ where: FILTRO.sugerencias }),
        leer("MODULE_FACE"), leer("FACE_CAMARAS"), leer("FACE_UMBRAL_MISMA"), leer("FACE_UMBRAL_PARECIDA"), leer("FACE_CARA_PX_MIN"), leer("FACE_ANONIMOS_DIAS"),
    ]);
    let camaras = 0;
    try { camaras = (JSON.parse(fCams || "[]") as unknown[]).length; } catch { /* sin cámaras elegidas */ }
    return {
        rostros: await aFilas(crudos), total,
        cuentas: { todos, "sin-registrar": sin, registrados: reg, frecuentes: frec, sugerencias: sug },
        motor: { prendido: mFace === "true", camaras, umbralMisma: num(uM, R.UMBRAL_MISMA), umbralParecida: num(uP, R.UMBRAL_PARECIDA), pxMin: num(px, R.CARA_PX_MIN), anonimosDias: num(dias, R.ANONIMOS_DIAS) },
    };
}

export async function fichaRostro(id: string): Promise<FichaRostro> {
    await sesionCon(...VER);
    const r = await prisma.rostro.findUnique({ where: { id } });
    if (!r) throw new Error("Esa cara ya no está: pudo olvidarse o unirse a otra.");
    const [fila] = await aFilas([r]);
    const [pasadas, totalPasadas, porCamara] = await Promise.all([
        prisma.rostroPasada.findMany({ where: { rostroId: id }, orderBy: { cuando: "desc" }, take: PASADAS_EN_FICHA }),
        prisma.rostroPasada.count({ where: { rostroId: id } }),
        prisma.rostroPasada.groupBy({ by: ["camara"], where: { rostroId: id }, _count: { _all: true } }),
    ]);
    return {
        ...fila, ejemplos: r.ejemplos, totalPasadas,
        pasadas: pasadas.map((p) => ({ id: p.id, cuando: p.cuando.toISOString(), camara: nombreCamara(p.camara), similitud: p.similitud, px: p.px, cara: imagen(p.cara), cuadro: imagen(p.cuadro) })),
        camaras: porCamara.map((c) => ({ camara: nombreCamara(c.camara) || "Sin nombre", veces: c._count._all })).sort((a, b) => b.veces - a.veces),
    };
}

/** Personas del padrón para decir «esta cara es de…». */
export async function buscarPersonasParaRostro(q: string): Promise<{ id: string; name: string; rol: string; cara: string | null }[]> {
    await sesionCon(...VER);
    const t = String(q || "").trim();
    if (t.length < 2) return [];
    const r = await prisma.user.findMany({ where: { name: { contains: t, mode: "insensitive" } }, select: { id: true, name: true, role: true, cara: true }, orderBy: { name: "asc" }, take: 12 });
    return r.map((u) => ({ id: u.id, name: u.name, rol: String(u.role), cara: u.cara }));
}

/* ── Cambiar ───────────────────────────────────────────────────────────────────── */

/** Decir quién es: alguien del padrón (`userId`) o sólo un nombre (`apodo`). Vacíos = volver a anónima. */
export async function registrarRostro(id: string, quien: { userId?: string | null; apodo?: string | null }): Promise<{ ok: true }> {
    const s = await sesionCon(...CAMBIAR);
    const r = await prisma.rostro.findUnique({ where: { id }, select: { numero: true } });
    if (!r) throw new Error("Esa cara ya no está.");
    const apodo = String(quien.apodo || "").trim().slice(0, 80) || null;
    let userId: string | null = null, nombre = apodo;
    if (quien.userId) {
        const u = await prisma.user.findUnique({ where: { id: quien.userId }, select: { id: true, name: true } });
        if (!u) throw new Error("Esa persona no está en el padrón.");
        userId = u.id; nombre = u.name;
    }
    await prisma.rostro.update({ where: { id }, data: { userId, apodo: userId ? null : apodo } });
    await auditar(s, nombre ? "rostro.registrar" : "rostro.anonimo", codigoRostro(r.numero), nombre ? `${userId ? "persona" : "apodo"}: ${nombre}` : "vuelve a quedar sin registrar");
    return { ok: true };
}

/** Cuántas visitas hacen esas pasadas: verla de nuevo dentro de VISITA_MS es la misma visita. */
function visitas(momentos: Date[]): number {
    const t = momentos.map((d) => d.getTime()).sort((a, b) => a - b);
    let n = 0, ultimo = -Infinity;
    for (const x of t) { if (x - ultimo > R.VISITA_MS) n++; ultimo = x; }
    return Math.max(1, n);
}

/**
 * Unir dos identidades que son la misma persona: el motor la partió en dos (otro ángulo, otra luz).
 * Queda `quedaId`; la otra le pasa sus pasadas y su cara como un ejemplo más, para que la próxima
 * vez el motor la reconozca sola.
 */
export async function unirRostros(quedaId: string, otraId: string): Promise<{ ok: true; id: string }> {
    const s = await sesionCon(...CAMBIAR);
    if (quedaId === otraId) throw new Error("Es la misma cara.");
    let [a, b] = await Promise.all([prisma.rostro.findUnique({ where: { id: quedaId } }), prisma.rostro.findUnique({ where: { id: otraId } })]);
    if (!a || !b) throw new Error("Una de las dos caras ya no está.");
    // Si una es del padrón (su sujeto en el motor es el nombre de la persona), queda ésa: su sujeto no se puede renombrar desde acá.
    if (!R.idDeSujeto(b.sujeto) && R.idDeSujeto(a.sujeto)) [a, b] = [b, a];
    if (!R.idDeSujeto(a.sujeto) && !R.idDeSujeto(b.sujeto)) throw new Error("Las dos son personas enroladas a mano en el padrón: se unen desde Usuarios, no desde acá.");

    // La cara de la que se va, como otro ejemplo de la que queda (si entra y el motor la toma).
    let ejemplos = a.ejemplos;
    if (b.foto && a.ejemplos < R.EJEMPLOS_MAX) {
        const jpeg = await bajar(b.foto);
        const r = jpeg ? await motor(`/api/v1/recognition/faces?subject=${encodeURIComponent(a.sujeto)}&det_prob_threshold=0.5`, { jpeg }).catch(() => null) : null;
        if (r?.ok) ejemplos++;
    }
    if (R.idDeSujeto(b.sujeto)) await olvidarSujeto(b.sujeto);

    await prisma.rostroPasada.updateMany({ where: { rostroId: b.id }, data: { rostroId: a.id } });
    const momentos = await prisma.rostroPasada.findMany({ where: { rostroId: a.id }, select: { cuando: true } });
    const mejorB = b.calidad > a.calidad && !!b.foto;
    await prisma.$transaction([
        prisma.rostro.update({
            where: { id: a.id },
            data: {
                veces: momentos.length ? visitas(momentos.map((m) => m.cuando)) : a.veces + b.veces,
                primeraVez: a.primeraVez < b.primeraVez ? a.primeraVez : b.primeraVez,
                ultimaVez: a.ultimaVez > b.ultimaVez ? a.ultimaVez : b.ultimaVez,
                ultimaCamara: a.ultimaVez > b.ultimaVez ? a.ultimaCamara : b.ultimaCamara,
                userId: a.userId || b.userId, apodo: a.userId || b.userId ? null : a.apodo || b.apodo,
                // La mejor de las dos fotos queda como la cara de la identidad.
                ...(mejorB ? { foto: b.foto, calidad: b.calidad } : {}),
                ejemplos, parecidaA: a.parecidaA === b.id ? null : a.parecidaA, parecido: a.parecidaA === b.id ? null : a.parecido,
                noEs: [...new Set([...a.noEs, ...b.noEs])].filter((x) => x !== a.id && x !== b.id),
            },
        }),
        // Las que se parecían a la que se va, ahora se parecen a la que queda.
        prisma.rostro.updateMany({ where: { parecidaA: b.id, id: { not: a.id } }, data: { parecidaA: a.id } }),
        prisma.rostro.delete({ where: { id: b.id } }),
    ]);
    await borrar([mejorB ? a.foto : b.foto]);
    await auditar(s, "rostro.unir", codigoRostro(a.numero), `se le unió ${codigoRostro(b.numero)}`);
    return { ok: true, id: a.id };
}

/** «No son la misma»: la sugerencia no se vuelve a ofrecer. */
export async function descartarParecido(id: string): Promise<{ ok: true }> {
    await sesionCon(...CAMBIAR);
    const r = await prisma.rostro.findUnique({ where: { id }, select: { parecidaA: true, noEs: true } });
    if (!r) throw new Error("Esa cara ya no está.");
    await prisma.rostro.update({ where: { id }, data: { parecidaA: null, parecido: null, noEs: r.parecidaA ? [...new Set([...r.noEs, r.parecidaA])] : r.noEs } });
    return { ok: true };
}

/**
 * Olvidar una cara: se borra del motor (deja de reconocerla), su foto, sus pasadas y sus recortes.
 * Los accesos FACE del historial quedan, sin la foto de la cara.
 */
export async function olvidarRostro(id: string): Promise<{ success: boolean; error?: string }> {
    try {
        const s = await sesionCon(...CAMBIAR);
        const r = await prisma.rostro.findUnique({ where: { id }, include: { pasadas: { select: { cara: true } } } });
        if (!r) return { success: true };
        // Una persona enrolada a mano en el padrón no se borra del motor desde acá: se saca desde su ficha o desde Ajustes.
        if (R.idDeSujeto(r.sujeto)) await olvidarSujeto(r.sujeto);
        await borrar([r.foto, ...r.pasadas.map((p) => p.cara)]);
        await prisma.rostro.updateMany({ where: { parecidaA: id }, data: { parecidaA: null, parecido: null } });
        await prisma.rostro.delete({ where: { id } });
        await auditar(s, "rostro.olvidar", codigoRostro(r.numero), `${r.veces} visitas, ${r.pasadas.length} pasadas`);
        return { success: true };
    } catch (e: any) { return { success: false, error: e?.message || "No se pudo olvidar" }; }
}
