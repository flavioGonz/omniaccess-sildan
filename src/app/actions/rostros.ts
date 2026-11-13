"use server";

import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { getS3Client } from "@/lib/s3";
import {
    codigoRostro, nombreCamara, FRECUENTE_DESDE, ROSTROS_POR_PAGINA, PASADAS_EN_FICHA, normalizarAjustesRostros, ROLES_PERSONA_DESDE_ROSTRO, pisoManual, USO_CAMARAS_DIAS, type UsoCamaraRostros,
    type FilaRostro, type FichaRostro, type FiltroRostro, type OrdenRostro, type AjustesRostros, type EstadoAjustesRostros, type AnalisisFoto, type ParecidoRostro, type RostroGuardado, type RolPersonaDesdeRostro,
} from "@/lib/rostros";
import { frecuencia, SUGERIR, VENTANA_DIAS, type Frecuencia } from "@/lib/rostros-frecuencia";
import { detallesConIdentidad, leerDetalleRostro } from "@/lib/monitor/rostro";
import {
    R, BUCKET_ROSTROS as BUCKET, imagenRostro as imagen, motorRostros, olvidarSujeto as olvidarEnMotor, enrolar, normalizarFoto, mirarCaras, recortesCara,
    subirRostro, bajarRostro as bajar, umbralesVigentes, fundarRostro, claveFoto, caraDeEscena, type CaraVista,
} from "@/lib/rostros-servidor";

/*
 * Las identidades por rostro, del lado del panel (13/11, Nico: «el modo face debe guardar el
 * rostro detectado y asignarle un id, compararlo para saber cuántas veces pasa, poder
 * registrarlo»). Las crea y las cuenta el proceso de visión (vision-rostros.js); acá se miran, se
 * les pone nombre, se unen cuando el motor partió a una persona en dos, y se olvidan.
 */

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

/* ── El motor y el bucket: lib/rostros-servidor ─────────────────────────────────── */

const motor = async (ruta: string, op: { metodo?: string; jpeg?: Buffer } = {}) => motorRostros(ruta, op);
const olvidarSujeto = olvidarEnMotor;

async function borrar(claves: (string | null)[]) {
    const objetos = claves.filter(Boolean).map((Key) => ({ Key: Key as string }));
    for (let i = 0; i < objetos.length; i += 1000) await (await getS3Client()).send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: objetos.slice(i, i + 1000), Quiet: true } })).catch(() => null);
}

/* ── Leer ──────────────────────────────────────────────────────────────────────── */

type Crudo = { id: string; numero: number; sujeto: string; userId: string | null; apodo: string | null; foto: string | null; calidad: number; veces: number; primeraVez: Date; ultimaVez: Date; ultimaCamara: string | null; parecidaA: string | null; parecido: number | null; ejemplos: number };

/** La frecuencia de cada cara, con sus pasadas de la ventana (lib/rostros-frecuencia). Una sola consulta para todas. */
async function frecuenciasDe(caras: { id: string; primeraVez: Date; registrada: boolean }[]): Promise<Map<string, Frecuencia>> {
    const ahora = Date.now(), out = new Map<string, Frecuencia>();
    if (!caras.length) return out;
    const pasadas = await prisma.rostroPasada.findMany({
        where: { rostroId: { in: caras.map((c) => c.id) }, cuando: { gte: new Date(ahora - VENTANA_DIAS * 86_400_000) } },
        select: { rostroId: true, cuando: true, camara: true },
    }).catch(() => []);
    const por = new Map<string, { cuando: Date; camara: string | null }[]>();
    for (const p of pasadas) { const l = por.get(p.rostroId) || []; l.push({ cuando: p.cuando, camara: nombreCamara(p.camara) }); por.set(p.rostroId, l); }
    for (const c of caras) out.set(c.id, frecuencia(por.get(c.id) || [], { ahora, registrada: c.registrada, primeraVez: c.primeraVez }));
    return out;
}

/** Las caras sin nombre que vienen seguido: a las que se sugiere registrar. */
async function idsParaRegistrar(): Promise<string[]> {
    // Con menos visitas que las que pide la sugerencia no hace falta ni mirar sus pasadas.
    const candidatas = await prisma.rostro.findMany({ where: { userId: null, apodo: null, veces: { gte: SUGERIR.visitas } }, select: { id: true, primeraVez: true }, orderBy: { ultimaVez: "desc" }, take: 2000 });
    const f = await frecuenciasDe(candidatas.map((c) => ({ ...c, registrada: false })));
    return candidatas.filter((c) => f.get(c.id)?.conviene).map((c) => c.id);
}

async function aFilas(crudos: Crudo[]): Promise<FilaRostro[]> {
    const ids = [...new Set(crudos.map((r) => r.userId).filter(Boolean) as string[])];
    const parecidas = [...new Set(crudos.map((r) => r.parecidaA).filter(Boolean) as string[])];
    const [personas, otras] = await Promise.all([
        ids.length ? prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, role: true, cara: true } }) : [],
        parecidas.length ? prisma.rostro.findMany({ where: { id: { in: parecidas } }, select: { id: true, numero: true, apodo: true, foto: true, userId: true } }) : [],
    ]);
    const porId = new Map(personas.map((u) => [u.id, u]));
    const otraPorId = new Map(otras.map((o) => [o.id, o]));
    const frec = await frecuenciasDe(crudos.map((r) => ({ id: r.id, primeraVez: r.primeraVez, registrada: !!(r.apodo || (r.userId && porId.has(r.userId))) })));
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
            frecuencia: frec.get(r.id) || frecuencia([], { registrada: true }),
            sugerencia: o && r.parecido != null ? { id: o.id, codigo: codigoRostro(o.numero), nombre: o.apodo || null, foto: imagen(o.foto), parecido: r.parecido } : null,
        };
    });
}

export type ListaRostros = {
    rostros: FilaRostro[]; total: number;
    cuentas: Record<FiltroRostro, number>;
    /** Cómo está trabajando el modo face: lo que la pantalla tiene que decir cuando no hay nada. */
    motor: { prendido: boolean; camaras: number; umbralMisma: number; umbralParecida: number; pxMin: number; anonimosDias: number };
    /** Cuántas pasadas dejó el modo face hoy (con o sin identidad) y cuántas de ésas quedaron sin identidad. */
    hoy: { pasadas: number; sinIdentidad: number };
};

const FILTRO: Record<Exclude<FiltroRostro, "para-registrar">, object> = {
    todos: {},
    "sin-registrar": { userId: null, apodo: null },
    registrados: { OR: [{ userId: { not: null } }, { apodo: { not: null } }] },
    frecuentes: { veces: { gte: FRECUENTE_DESDE } },
    sugerencias: { parecidaA: { not: null } },
};

export async function listarRostros(op: { filtro?: FiltroRostro; orden?: OrdenRostro; q?: string; pagina?: number } = {}): Promise<ListaRostros> {
    await sesionCon(...VER);
    const filtro: FiltroRostro = op.filtro === "para-registrar" || (op.filtro && FILTRO[op.filtro]) ? op.filtro : "todos";
    // «Para registrar» no es una columna: sale de mirar las pasadas (ver idsParaRegistrar).
    const convienen = await idsParaRegistrar();
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
    const where = { AND: [filtro === "para-registrar" ? { id: { in: convienen } } : FILTRO[filtro], busca] };
    const orderBy = op.orden === "veces" ? [{ veces: "desc" as const }, { ultimaVez: "desc" as const }] : op.orden === "nuevos" ? [{ primeraVez: "desc" as const }] : [{ ultimaVez: "desc" as const }];
    const pagina = Math.max(0, Math.trunc(Number(op.pagina) || 0));
    const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
    const leer = async (k: string) => (await prisma.setting.findUnique({ where: { key: k } }).catch(() => null))?.value ?? null;
    const num = (v: string | null, def: number) => (v != null && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : def);
    const [crudos, total, todos, sin, reg, frec, sug, mFace, fCams, uM, uP, px, dias, pasadasHoy, sinIdHoy] = await Promise.all([
        prisma.rostro.findMany({ where, orderBy, skip: pagina * ROSTROS_POR_PAGINA, take: ROSTROS_POR_PAGINA }),
        prisma.rostro.count({ where }),
        prisma.rostro.count(), prisma.rostro.count({ where: FILTRO["sin-registrar"] }), prisma.rostro.count({ where: FILTRO.registrados }),
        prisma.rostro.count({ where: FILTRO.frecuentes }), prisma.rostro.count({ where: FILTRO.sugerencias }),
        leer("MODULE_FACE"), leer("FACE_CAMARAS"), leer("FACE_UMBRAL_MISMA"), leer("FACE_UMBRAL_PARECIDA"), leer("FACE_CARA_PX_MIN"), leer("FACE_ANONIMOS_DIAS"),
        prisma.accessEvent.count({ where: { accessType: "FACE", timestamp: { gte: hoy0 }, details: { contains: "Source: OmniVision" } } }).catch(() => 0),
        prisma.accessEvent.count({ where: { accessType: "FACE", timestamp: { gte: hoy0 }, details: { contains: "Identidad: sin-cara" } } }).catch(() => 0),
    ]);
    let camaras = 0;
    try { camaras = (JSON.parse(fCams || "[]") as unknown[]).length; } catch { /* sin cámaras elegidas */ }
    return {
        rostros: await aFilas(crudos), total,
        cuentas: { todos, "sin-registrar": sin, registrados: reg, frecuentes: frec, sugerencias: sug, "para-registrar": convienen.length },
        hoy: { pasadas: pasadasHoy, sinIdentidad: sinIdHoy },
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
        // Si esta cara era la foto de alguien del padrón (crearPersonaDesdeRostro), esa persona queda sin foto: el archivo se borra acá.
        if (r.foto) await prisma.user.updateMany({ where: { cara: imagen(r.foto) }, data: { cara: null } }).catch(() => null);
        await borrar([r.foto, ...r.pasadas.map((p) => p.cara)]);
        await prisma.rostro.updateMany({ where: { parecidaA: id }, data: { parecidaA: null, parecido: null } });
        await prisma.rostro.delete({ where: { id } });
        await auditar(s, "rostro.olvidar", codigoRostro(r.numero), `${r.veces} visitas, ${r.pasadas.length} pasadas`);
        return { success: true };
    } catch (e: any) { return { success: false, error: e?.message || "No se pudo olvidar" }; }
}


/* ── Ajustes del motor ─────────────────────────────────────────────────────────── */

const CLAVES_AJUSTE: Record<keyof AjustesRostros, string> = { misma: "FACE_UMBRAL_MISMA", parecida: "FACE_UMBRAL_PARECIDA", padron: "FACE_UMBRAL", pxMin: "FACE_CARA_PX_MIN", anonimosDias: "FACE_ANONIMOS_DIAS" };
const POR_DEFECTO = (): AjustesRostros => ({ misma: R.UMBRAL_MISMA, parecida: R.UMBRAL_PARECIDA, padron: 0.89, pxMin: R.CARA_PX_MIN, anonimosDias: R.ANONIMOS_DIAS });

/** Los porcentajes de acierto y las demás perillas del modo face, como están hoy. */
export async function leerAjustesRostros(): Promise<EstadoAjustesRostros> {
    await sesionCon(...VER);
    const u = await umbralesVigentes();
    return { misma: u.misma, parecida: u.parecida, padron: u.padron, pxMin: u.pxMin, anonimosDias: u.anonimosDias, porDefecto: POR_DEFECTO() };
}

/**
 * Guardar los ajustes (13/11, Nico: «debo poder ajustar los % de aciertos»). Sólo se escribe lo
 * que cambió; el proceso de visión los vuelve a leer solo, en menos de un minuto. No tocan lo ya
 * decidido: las caras que ya se sumaron o se separaron quedan como están.
 */
export async function guardarAjustesRostros(cambios: Partial<AjustesRostros>): Promise<EstadoAjustesRostros & { avisos: string[] }> {
    const s = await sesionCon(...CAMBIAR);
    const u = await umbralesVigentes();
    const antes: AjustesRostros = { misma: u.misma, parecida: u.parecida, padron: u.padron, pxMin: u.pxMin, anonimosDias: u.anonimosDias };
    const { ajustes, avisos } = normalizarAjustesRostros(cambios, antes);
    const cambiados = (Object.keys(CLAVES_AJUSTE) as (keyof AjustesRostros)[]).filter((k) => ajustes[k] !== antes[k]);
    for (const k of cambiados) await prisma.setting.upsert({ where: { key: CLAVES_AJUSTE[k] }, update: { value: String(ajustes[k]) }, create: { key: CLAVES_AJUSTE[k], value: String(ajustes[k]) } });
    if (cambiados.length) await auditar(s, "rostro.ajustes", "motor de rostros", cambiados.map((k) => `${k}: ${antes[k]} → ${ajustes[k]}`).join(", "));
    return { ...ajustes, porDefecto: POR_DEFECTO(), avisos };
}

/* ── Subir una foto ────────────────────────────────────────────────────────────── */

/**
 * Foto subida: tiene que ser una imagen y entrar en lo que aceptan las acciones del servidor
 * (next.config › serverActions.bodySizeLimit, 10 MB). El cajón ya la manda achicada; esto es para
 * la que no pudo achicar.
 */
const FOTO_MAX_BYTES = 9 * 1024 * 1024;
async function fotoDe(fd: FormData): Promise<{ jpeg: Buffer; ancho: number; alto: number }> {
    const f = fd.get("foto");
    if (!(f instanceof Blob) || !f.size) throw new Error("Falta la foto.");
    if (f.size > FOTO_MAX_BYTES) throw new Error("La foto pesa más de 9 MB: achicala o sacá otra.");
    if (f.type && !f.type.startsWith("image/")) throw new Error("Eso no es una imagen.");
    try { return await normalizarFoto(Buffer.from(await f.arrayBuffer())); }
    catch { throw new Error("No se pudo leer la imagen: probá con un JPG o un PNG."); }
}

/** A quién se parece una cara, con nombre y foto para mostrar. */
async function parecidosDe(cara: CaraVista): Promise<ParecidoRostro[]> {
    const out: ParecidoRostro[] = [];
    for (const v of cara.vecinos.slice(0, 3)) {
        const id = R.idDeSujeto(v.sujeto);
        const r = await prisma.rostro.findFirst({ where: id ? { id } : { sujeto: v.sujeto }, select: { id: true, numero: true, apodo: true, foto: true, userId: true } }).catch(() => null);
        const u = r?.userId ? await prisma.user.findUnique({ where: { id: r.userId }, select: { name: true } }).catch(() => null) : null;
        // Un sujeto `rostro-…` sin fila es alguien que la base ya olvidó: no se muestra como parecido.
        if (id && !r) continue;
        out.push({ similitud: v.similitud, rostro: r ? { id: r.id, codigo: codigoRostro(r.numero), nombre: u?.name || r.apodo || null, foto: imagen(r.foto) } : null, persona: id ? null : v.sujeto });
    }
    return out;
}

/**
 * Mirar una foto subida SIN guardar nada: dónde está la cara, si alcanza para comparar y a quién
 * se parece. Es el primer paso del cajón «Agregar un rostro»; el segundo es `guardarFotoRostro`.
 */
export async function analizarFotoRostro(fd: FormData): Promise<AnalisisFoto> {
    await sesionCon(...CAMBIAR);
    const { jpeg, ancho: W, alto: H } = await fotoDe(fd);
    const [caras, u, comparadas] = await Promise.all([mirarCaras(jpeg), umbralesVigentes(), prisma.rostro.count()]);
    const umbrales = { misma: u.misma, parecida: u.parecida, pxMin: u.pxMin };
    const cara = caras[0];
    if (!cara) return { caras: 0, cara: null, veredicto: "sin-cara", motivo: "El motor no encontró ninguna cara en la foto. Sirve una de frente, con luz, donde la cara se vea entera.", parecidos: [], comparadas, umbrales };
    const recorte = (await recortesCara(jpeg, cara.caja)).chica;
    const parecidos = await parecidosDe(cara);
    const d = R.decidir(cara, cara.vecinos, u);
    // Alguien ya conocido: una identidad por encima de «misma persona», o alguien del padrón por encima de su umbral.
    const conocida = d.que === "misma" || d.que === "padron";
    const veredicto: AnalisisFoto["veredicto"] = conocida && parecidos[0] ? "conocida" : d.que === "sin-cara" ? (cara.px < u.pxMin ? "chica" : "dudosa") : "nueva";
    const motivo = veredicto === "chica" ? `La cara mide ${cara.px} px de alto y hacen falta ${u.pxMin}: con una cara tan chica el motor confunde personas distintas.`
        : veredicto === "dudosa" ? `El motor no está seguro de que eso sea una cara (${Math.round(cara.prob * 100)} %).` : null;
    return {
        caras: caras.length,
        cara: { px: cara.px, prob: cara.prob, recorte: `data:image/jpeg;base64,${recorte.toString("base64")}`, caja: [cara.caja.x_min / W, cara.caja.y_min / H, cara.caja.x_max / W, cara.caja.y_max / H] },
        veredicto, motivo, parecidos, comparadas, umbrales,
    };
}

/**
 * Guardar la cara de una foto subida. Dos caminos:
 *  · `sumarA`: es alguien que ya está — la foto se le da al motor como otro ejemplo de esa identidad.
 *  · sin `sumarA`: nace una identidad nueva, con su número; `apodo` o `userId` la dejan registrada.
 * Una cara chica o dudosa se guarda sólo con `igual: 1`: lo decide quien la sube, sabiendo por qué.
 */
export async function guardarFotoRostro(fd: FormData): Promise<RostroGuardado> {
    const s = await sesionCon(...CAMBIAR);
    const { jpeg } = await fotoDe(fd);
    const sumarA = String(fd.get("sumarA") || "") || null, apodo = String(fd.get("apodo") || "").trim().slice(0, 80) || null, userId = String(fd.get("userId") || "") || null;
    const igual = fd.get("igual") === "1";
    const cara = (await mirarCaras(jpeg))[0];
    if (!cara) throw new Error("El motor no encontró ninguna cara en la foto.");
    const u = await umbralesVigentes();
    if (!igual && (cara.px < u.pxMin || cara.prob < u.probMin)) throw new Error("La cara no alcanza para comparar bien. Si igual querés guardarla, confirmalo.");
    const recortes = await recortesCara(jpeg, cara.caja);

    if (sumarA) {
        const r = await prisma.rostro.findUnique({ where: { id: sumarA } });
        if (!r) throw new Error("Esa cara ya no está.");
        if (r.ejemplos >= R.EJEMPLOS_MAX) throw new Error(`Esa cara ya tiene ${R.EJEMPLOS_MAX} fotos en el motor, que es el tope.`);
        const e = await enrolar(r.sujeto, recortes.nativa);
        if (!e.ok) throw new Error(`El motor de rostros respondió ${e.estado} al sumar la foto.`);
        const mejor = !r.foto || cara.px > r.calidad;
        if (mejor) await subirRostro(claveFoto(r.id), recortes.chica);
        const q = await prisma.rostro.update({ where: { id: r.id }, data: { ejemplos: { increment: 1 }, ...(mejor ? { foto: claveFoto(r.id), calidad: cara.px } : {}) } });
        await auditar(s, "rostro.ejemplo", codigoRostro(r.numero), `foto subida (${cara.px} px)`);
        const [fila] = await aFilas([q]);
        return { id: r.id, codigo: fila.codigo, nombre: fila.nombre, nueva: false, ejemplos: q.ejemplos };
    }

    let nombre = apodo;
    if (userId) {
        const p = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
        if (!p) throw new Error("Esa persona no está en el padrón.");
        nombre = p.name;
    }
    const d = R.decidir(cara, cara.vecinos, u);
    const r = await fundarRostro(recortes, { px: cara.px, cuando: new Date(), camara: null, apodo, userId, ...(d.que === "nueva" ? { parecidaA: d.parecidaA, parecido: d.parecido } : {}) });
    // Ninguna cámara la vio todavía: la primera vez que pase va a ser su visita número uno.
    await prisma.rostro.update({ where: { id: r.id }, data: { veces: 0 } });
    await auditar(s, "rostro.subir", codigoRostro(r.numero), `${nombre ? `registrada como ${nombre}` : "sin nombre"} · ${cara.px} px${igual ? " · guardada aunque no alcanzaba" : ""}`);
    return { id: r.id, codigo: codigoRostro(r.numero), nombre, nueva: true, ejemplos: 1 };
}

/**
 * «Agregar como rostro conocido» desde el Monitor Face: una pasada que quedó sin identidad (la
 * cara era chica, o el motor dudó) y que el operador decide guardar igual porque SABE quién es.
 * Nace la identidad con el recorte de esa pasada, y el acceso y la pasada quedan a su nombre.
 */
export async function rostroDesdeEvento(eventoId: string): Promise<RostroGuardado> {
    const s = await sesionCon(...CAMBIAR);
    const ev = await prisma.accessEvent.findUnique({ where: { id: eventoId }, select: { id: true, accessType: true, details: true, timestamp: true, deviceId: true, snapshotPath: true, device: { select: { name: true } } } });
    if (!ev || ev.accessType !== "FACE") throw new Error("Ese acceso ya no está.");
    const d = leerDetalleRostro(ev.details);
    if (d.rostroId && (await prisma.rostro.findUnique({ where: { id: d.rostroId }, select: { id: true } }))) throw new Error("Esa pasada ya tiene una cara: abrila para registrarla.");
    const u = await umbralesVigentes();
    // Hay un piso que no se pasa ni a mano (lib/rostros › pisoManual, con su porqué).
    if (d.caraPx != null && d.caraPx < pisoManual(u.pxMin)) throw new Error(`Esa cara mide ${d.caraPx} px: con menos de ${pisoManual(u.pxMin)} px no se guarda ni a mano, porque el motor confunde personas distintas.`);
    const aClave = (r: string | null | undefined) => (r?.startsWith("/api/vision/imagen/") ? r.slice("/api/vision/imagen/".length) : null);
    const clave = aClave(d.recorte);
    /*
     * La cara se vuelve a sacar de la escena, agrandada: en el recorte guardado el motor no la
     * encuentra (lib/rostros-servidor › caraDeEscena, con la medición). El recorte guardado queda
     * de último recurso, para una pasada vieja sin escena o sin caja.
     */
    const escena = d.caja ? await bajar(aClave(d.escena) || aClave(ev.snapshotPath) || "") : null;
    const candidatas: Buffer[] = [];
    if (escena && d.caja) candidatas.push(await caraDeEscena(escena, d.caja));
    const guardado = clave ? await bajar(clave) : null;
    if (guardado) candidatas.push(guardado);
    if (!candidatas.length) throw new Error("Ya no están guardadas ni la escena ni el recorte de esa pasada (viven lo que las detecciones).");
    let jpeg = candidatas[0], cara: CaraVista | undefined;
    // Ya se sabe que ahí hay una cara: el piso de detección baja para que el motor la tome.
    for (const c of candidatas) { cara = (await mirarCaras(c, 0.5))[0]; if (cara) { jpeg = c; break; } }
    if (!cara) throw new Error("El motor no encuentra la cara en esa pasada: está de perfil, tapada o demasiado lejos.");
    // Si a esta altura se parece de sobra a alguien conocido, se le suma a ése en vez de partirlo en dos.
    const top = cara.vecinos[0], idTop = top ? R.idDeSujeto(top.sujeto) : null;
    let r = top && idTop && top.similitud >= u.misma ? await prisma.rostro.findUnique({ where: { id: idTop } }) : null;
    const nueva = !r;
    const camara = ev.device?.name || null;
    if (!r) r = await fundarRostro(await recortesCara(jpeg, cara.caja), { px: d.caraPx || cara.px, cuando: ev.timestamp, camara, ...(top && top.similitud >= u.parecida ? { parecidaA: top.sujeto, parecido: top.similitud } : {}) });
    const [fila] = await aFilas([r]);
    await prisma.accessEvent.update({ where: { id: ev.id }, data: { details: detallesConIdentidad(ev.details, { rostroId: r.id, nombre: fila.nombre || fila.codigo, veces: r.veces }), ...(r.userId ? { userId: r.userId } : {}) } });
    const cuadro = ev.snapshotPath?.startsWith("/api/vision/imagen/") ? ev.snapshotPath.slice("/api/vision/imagen/".length) : null;
    if (ev.deviceId && !(await prisma.rostroPasada.findFirst({ where: { eventoId: ev.id }, select: { id: true } }))) {
        await prisma.rostroPasada.create({ data: { rostroId: r.id, deviceId: ev.deviceId, camara: camara || "", cuando: ev.timestamp, similitud: nueva ? null : top!.similitud, px: d.caraPx || cara.px, prob: cara.prob, cara: clave, cuadro, eventoId: ev.id } });
    }
    await auditar(s, "rostro.desde-evento", fila.codigo, `${nueva ? "cara nueva" : "sumada a una conocida"} · ${d.caraPx || cara.px} px · ${d.sinIdentidad || "sin identidad"}`);
    return { id: r.id, codigo: fila.codigo, nombre: fila.nombre, nueva, ejemplos: r.ejemplos };
}

/**
 * Crear a la persona en el padrón desde su cara (13/11, Nico: «permite registrar personas»). Antes
 * había que salir a Usuarios, crearla y volver a elegirla. Se crea con lo mínimo —nombre y qué es—
 * y con esta cara como su foto; el resto (unidad, matrículas, grupos) se completa en su ficha.
 */
export async function crearPersonaDesdeRostro(id: string, datos: { nombre: string; rol: RolPersonaDesdeRostro }): Promise<{ ok: true; userId: string; nombre: string }> {
    const s = await sesionCon("usuarios.editar");
    await sesionCon(...CAMBIAR);
    const nombre = String(datos.nombre || "").trim().replace(/\s+/g, " ").slice(0, 80);
    if (nombre.length < 2) throw new Error("Falta el nombre.");
    if (!ROLES_PERSONA_DESDE_ROSTRO.some((x) => x.valor === datos.rol)) throw new Error("Desde acá se crean residentes, personal, proveedores o visitantes.");
    const r = await prisma.rostro.findUnique({ where: { id }, select: { numero: true, foto: true } });
    if (!r) throw new Error("Esa cara ya no está.");
    // El nombre es también como el motor llama a los enrolados a mano: dos personas con el mismo nombre se pisarían.
    const repetida = await prisma.user.findFirst({ where: { name: { equals: nombre, mode: "insensitive" } }, select: { id: true } });
    if (repetida) throw new Error(`Ya hay alguien que se llama ${nombre} en el padrón: elegila de la lista en vez de crearla de nuevo.`);
    const u = await prisma.user.create({ data: { name: nombre, role: datos.rol, cara: imagen(r.foto), createdBy: String(s?.name || s?.sub || "panel") }, select: { id: true, name: true } });
    await prisma.rostro.update({ where: { id }, data: { userId: u.id, apodo: null } });
    await auditar(s, "rostro.crear-persona", codigoRostro(r.numero), `${u.name} (${datos.rol})`);
    return { ok: true, userId: u.id, nombre: u.name };
}

/* ── El motor por dentro ───────────────────────────────────────────────────────── */

/**
 * Lo que el motor tiene enrolado contra lo que la base conoce. Un sujeto `rostro-…` sin fila es
 * una cara que ya se olvidó acá pero que el motor sigue reconociendo; una fila sin sujeto es una
 * cara que el motor ya no puede reconocer (alguien vació el motor).
 */
export async function estadoMotorRostros(): Promise<{ conectado: boolean; error: string | null; enMotor: number; identidades: number; delPadron: number; huerfanos: number; sinMotor: number }> {
    await sesionCon(...VER);
    const filas = await prisma.rostro.findMany({ select: { sujeto: true } });
    const conocidos = new Set(filas.map((f) => f.sujeto));
    try {
        const r = await motor("/api/v1/recognition/subjects", { metodo: "GET" });
        if (!r.ok) return { conectado: false, error: `El motor respondió ${r.estado}`, enMotor: 0, identidades: filas.length, delPadron: 0, huerfanos: 0, sinMotor: 0 };
        const sujetos: string[] = (r.j?.subjects || []).map(String);
        const enMotor = new Set(sujetos);
        return {
            conectado: true, error: null, enMotor: sujetos.length, identidades: filas.length,
            delPadron: sujetos.filter((x) => !R.idDeSujeto(x)).length,
            huerfanos: sujetos.filter((x) => R.idDeSujeto(x) && !conocidos.has(x)).length,
            sinMotor: filas.filter((f) => R.idDeSujeto(f.sujeto) && !enMotor.has(f.sujeto)).length,
        };
    } catch (e: any) { return { conectado: false, error: e?.name === "TimeoutError" ? "El motor no contestó a tiempo" : e?.message || "Sin conexión con el motor", enMotor: 0, identidades: filas.length, delPadron: 0, huerfanos: 0, sinMotor: 0 }; }
}

/** Sacar del motor las caras que la base ya olvidó. No toca a nadie que tenga ficha ni a los enrolados a mano. */
export async function limpiarHuerfanosRostros(): Promise<{ borrados: number }> {
    const s = await sesionCon(...CAMBIAR);
    const [filas, r] = await Promise.all([prisma.rostro.findMany({ select: { sujeto: true } }), motor("/api/v1/recognition/subjects", { metodo: "GET" })]);
    if (!r.ok) throw new Error(`El motor respondió ${r.estado}`);
    const conocidos = new Set(filas.map((f) => f.sujeto));
    const huerfanos: string[] = (r.j?.subjects || []).map(String).filter((x: string) => R.idDeSujeto(x) && !conocidos.has(x));
    let borrados = 0;
    for (const h of huerfanos) { const b = await olvidarSujeto(h); if (b?.ok) borrados++; }
    if (borrados) await auditar(s, "rostro.limpiar-motor", "motor de rostros", `${borrados} caras que la base ya había olvidado`);
    return { borrados };
}

/** Una pasada de hoy que quedó sin identidad: la cara no alcanzó para comparar. */
export type CapturaSinIdentidad = { eventoId: string; cara: string; px: number | null; motivo: string | null; camara: string | null; cuando: string;
    /** Si se puede agregar a mano: su cara llega al piso (lib/rostros › pisoManual). */
    agregable: boolean };
/** Cuántas capturas sin identidad se muestran (las últimas). */
const CAPTURAS_SIN_IDENTIDAD = 18;

/**
 * Las últimas pasadas que quedaron sin identidad y todavía tienen su recorte guardado. Están para
 * que quien SABE quién es pueda agregarla igual (`rostroDesdeEvento`), y para ver de un vistazo
 * cuántas caras se pierden por chicas: es el dato para decidir si bajar el mínimo o mover la cámara.
 */
export async function listarCapturasSinIdentidad(): Promise<CapturaSinIdentidad[]> {
    await sesionCon(...VER);
    const evs = await prisma.accessEvent.findMany({
        where: { accessType: "FACE", details: { contains: "Identidad: sin-cara" }, timestamp: { gte: new Date(Date.now() - 48 * 3600_000) } },
        orderBy: { timestamp: "desc" }, take: CAPTURAS_SIN_IDENTIDAD * 2, select: { id: true, details: true, timestamp: true, device: { select: { name: true } } },
    }).catch(() => []);
    const piso = pisoManual((await umbralesVigentes()).pxMin);
    const out: CapturaSinIdentidad[] = [];
    for (const e of evs) {
        const d = leerDetalleRostro(e.details);
        if (!d.recorte || d.rostroId) continue;
        out.push({ eventoId: e.id, cara: d.recorte, px: d.caraPx, motivo: d.sinIdentidad, camara: nombreCamara(e.device?.name), cuando: e.timestamp.toISOString(), agregable: d.caraPx == null || d.caraPx >= piso });
        if (out.length >= CAPTURAS_SIN_IDENTIDAD) break;
    }
    return out;
}

/**
 * Lo que dio cada cámara al modo face en los últimos días: cuántas caras vio, de qué tamaño
 * (la mediana) y cuántas alcanzaron para tener identidad. Es el dato para decidir qué cámaras
 * sirven para mirar caras: el 13/11 había 17 elegidas y 17 de las 20 pasadas del día quedaron sin
 * identidad, casi todas de cámaras de escena donde la cara mide 16 a 33 px.
 */
export async function usoCamarasRostros(): Promise<UsoCamaraRostros[]> {
    await sesionCon(...VER);
    const evs = await prisma.accessEvent.findMany({
        where: { accessType: "FACE", details: { contains: "Source: OmniVision" }, timestamp: { gte: new Date(Date.now() - USO_CAMARAS_DIAS * 86_400_000) } },
        select: { deviceId: true, details: true }, orderBy: { timestamp: "desc" }, take: 5000,
    }).catch(() => []);
    const por = new Map<string, { n: number; con: number; px: number[] }>();
    for (const e of evs) {
        if (!e.deviceId) continue;
        const d = leerDetalleRostro(e.details);
        const c = por.get(e.deviceId) || { n: 0, con: 0, px: [] };
        c.n++; if (d.identidad && d.identidad !== "sin-cara") c.con++; if (d.caraPx != null) c.px.push(d.caraPx);
        por.set(e.deviceId, c);
    }
    return [...por.entries()].map(([deviceId, c]) => { const o = c.px.sort((a, b) => a - b); return { deviceId, pasadas: c.n, conIdentidad: c.con, pxMediana: o.length ? o[Math.floor(o.length / 2)] : null }; });
}
