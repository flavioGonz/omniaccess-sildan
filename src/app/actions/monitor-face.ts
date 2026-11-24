"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { TIPOS_CARA } from "@/lib/caras-vivo";
import { leerDetalleRostro, calidadRostro } from "@/lib/monitor/rostro";
import { identidadDe, tramosDeTamano, type IdentidadPaso, type QueMostrar, type UmbralesFace } from "@/lib/monitor-face";
import { pisoManual } from "@/lib/rostros";
import { umbralesVigentes } from "@/lib/rostros-servidor";

/**
 * Monitor Face: las caras que pasaron por cada portero y control de acceso (24/11; antes «Bitácora
 * de equipos», del 18/11).
 *
 * Por qué es una pantalla aparte y no un filtro del Historial: el Historial es de matrículas, una
 * fila por lectura y la chapa como sujeto. Acá el sujeto es una PERSONA frente a una puerta, y lo
 * que se viene a mirar es su cara y qué se sabe de ella.
 *
 * Lo que hay de cada captura depende de quién la contó: el equipo sabe a quién reconoció y con qué
 * (tarjeta, rostro, PIN); OmniVision sabe qué cara vio, de qué tamaño, cuánto se parecía y qué
 * decidió. Se muestran las dos cosas y se dice cuál es cuál — de dónde sale un dato es parte del dato.
 * El porqué de las ráfagas y del resumen está en lib/monitor-face.ts.
 */

const MAX = 400;

/** ¿Esta instalación tiene algún portero o control de acceso? El menú no ofrece una sección vacía. */
export async function hayEquiposDeAcceso(): Promise<boolean> {
    return (await prisma.device.count({ where: { deviceType: { in: TIPOS_CARA as unknown as string[] } as never } }).catch(() => 0)) > 0;
}

export type CapturaFace = {
    id: string;
    cuando: string;
    deviceId: string | null;
    equipo: string;
    /** "equipo" (lo contó el portero) | "omnivision" (lo vimos nosotros). */
    fuente: "equipo" | "omnivision";
    decision: string | null;
    /** TAG | FACE | PIN | FINGERPRINT | null. */
    tipo: string | null;
    /** El nombre del padrón, el apodo o el código de la identidad (R-0012), o lo que dijo el equipo. */
    persona: string | null;
    /** El legajo o la tarjeta, cuando el equipo lo dice. */
    credencial: string | null;
    /** Cuánto se parecía a quien se decidió, en %. */
    similitud: number | null;
    /** El recorte de la cara (nuestro) o la foto del paso. */
    cara: string | null;
    foto: string | null;
    /** La escena del stream principal, cuando se guardó (es la foto grande, con más detalle que `foto`). */
    escena: string | null;
    /** Dónde está la cara en la escena, en fracciones [x1, y1, x2, y2]. */
    caja: [number, number, number, number] | null;
    sentido: string | null;
    detalle: string | null;
    /** Está en el padrón (el evento quedó atado a una persona). */
    registrado: boolean;
    /* Lo que analizó OmniVision. En lo que contó el equipo, todo null. */
    identidad: IdentidadPaso;
    rostroId: string | null;
    /** Cuántas visitas llevaba esa identidad en ese momento. */
    veces: number | null;
    /** Alto de la cara en px del cuadro que miró el motor. */
    caraPx: number | null;
    /** Confianza de detección del motor, en %. */
    deteccion: number | null;
    /** Alto de la cara sobre el alto de la escena, en %. */
    caraFrac: number | null;
    /** 0–100: detección y tamaño juntos (lib/monitor/rostro › calidadRostro). */
    calidad: number | null;
    /** Por qué quedó sin comparar, como lo escribió el proceso de visión. */
    sinIdentidad: string | null;
};

export type EquipoDeAcceso = {
    id: string; nombre: string; ip: string; tipo: string; ubicacion: string | null;
    hoy: number; ultima: string | null;
    /** Cuántas capturas contó cada lado en lo que se trajo: dice si al equipo se lo está escuchando. */
    delEquipo: number; propias: number;
};

export type MonitorFace = {
    capturas: CapturaFace[];
    equipos: EquipoDeAcceso[];
    desdeDias: number;
    /** Si llegó al tope: hay más capturas en el período que las que se muestran. */
    recortado: boolean;
    umbrales: UmbralesFace;
    /** Qué se puede hacer desde la hoja de una captura. */
    puede: { verFicha: boolean; registrar: boolean };
    /** Por debajo de este alto de cara no se deja agregar ni a mano (lib/rostros › pisoManual). */
    pisoManual: number;
};

const esNuestro = (d: string | null) => /Source:\s*OmniVision/i.test(d || "");

async function sesionConHistorial() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    const permisos = s ? permisosDeSesion(s) : [];
    if (!permisos.includes("historial")) throw new Error("Tu rol no puede ver el historial.");
    return permisos;
}

async function equiposDeCara() {
    return prisma.device.findMany({
        where: { deviceType: { in: TIPOS_CARA as unknown as string[] } as never },
        select: { id: true, name: true, ip: true, deviceType: true, location: true },
        orderBy: { name: "asc" },
    });
}

/** El filtro de arriba, en Prisma. Las de OmniVision llevan su decisión escrita en `details`. */
function filtroDe(que: QueMostrar) {
    const sinCara = { details: { contains: "Identidad: sin-cara" } };
    switch (que) {
        case "identificadas": return { accessType: "FACE", NOT: sinCara };
        case "sin-comparar": return sinCara;
        case "negadas": return { decision: "DENY" };
        case "tarjeta": return { NOT: { accessType: "FACE" } };
        default: return {};
    }
}

export async function monitorFace({ dias = 7, deviceId = null as string | null, q = "", que = "todas" as QueMostrar } = {}): Promise<MonitorFace> {
    const permisos = await sesionConHistorial();
    const equipos = await equiposDeCara();
    const ids = equipos.map((e) => e.id).filter((id) => !deviceId || id === deviceId);
    const desde = new Date(Date.now() - dias * 86_400_000);
    const filas = ids.length
        ? await prisma.accessEvent.findMany({
            where: {
                deviceId: { in: ids }, timestamp: { gte: desde },
                ...filtroDe(que),
                ...(q ? { OR: [{ details: { contains: q, mode: "insensitive" } }, { credentialId: { contains: q, mode: "insensitive" } }, { user: { name: { contains: q, mode: "insensitive" } } }] } : {}),
            } as never,
            select: {
                id: true, deviceId: true, timestamp: true, details: true, accessType: true, decision: true,
                direction: true, credentialId: true, snapshotPath: true, imagePath: true,
                user: { select: { name: true } },
            },
            orderBy: { timestamp: "desc" }, take: MAX,
        })
        : [];

    const nombre = new Map(equipos.map((e) => [e.id, e.name]));
    const capturas: CapturaFace[] = filas.map((f) => {
        const nuestro = esNuestro(f.details);
        const dr = nuestro ? leerDetalleRostro(f.details) : null;
        /* El equipo escribe «Rostro reconocido · «Ana» · legajo 1108 · #acs16272»; nosotros,
           «Rostro: Ana, Similitud: 88%, …». Cada uno se lee con su forma y no se mezclan. */
        const delEquipo = !nuestro ? /«([^»]+)»/.exec(f.details || "")?.[1] || null : null;
        return {
            id: f.id,
            cuando: f.timestamp.toISOString(),
            deviceId: f.deviceId,
            equipo: (f.deviceId && nombre.get(f.deviceId)) || "—",
            fuente: nuestro ? "omnivision" : "equipo",
            decision: f.decision || null,
            tipo: f.accessType || null,
            persona: f.user?.name || dr?.nombre || delEquipo || null,
            credencial: f.credentialId || /legajo\s+([^\s·,]+)/i.exec(f.details || "")?.[1] || null,
            similitud: dr?.similitud ?? null,
            cara: dr?.recorte || null,
            foto: f.snapshotPath || f.imagePath || null,
            escena: dr?.escena || null,
            caja: dr?.caja || null,
            sentido: f.direction || null,
            detalle: f.details || null,
            registrado: !!f.user?.name,
            identidad: identidadDe(nuestro, dr?.identidad ?? null),
            rostroId: dr?.rostroId || null,
            veces: dr?.veces ?? null,
            caraPx: dr?.caraPx ?? null,
            deteccion: dr?.deteccion ?? null,
            caraFrac: dr?.caraFrac ?? null,
            calidad: dr ? calidadRostro(dr.deteccion, dr.caraFrac) : null,
            sinIdentidad: dr?.sinIdentidad || null,
        };
    });

    const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
    const cuenta = new Map<string, { hoy: number; ultima: string | null; delEquipo: number; propias: number }>();
    for (const e of equipos) cuenta.set(e.id, { hoy: 0, ultima: null, delEquipo: 0, propias: 0 });
    for (const p of capturas) {
        const c = p.deviceId ? cuenta.get(p.deviceId) : null;
        if (!c) continue;
        if (new Date(p.cuando) >= hoy0) c.hoy++;
        if (!c.ultima) c.ultima = p.cuando;
        if (p.fuente === "equipo") c.delEquipo++; else c.propias++;
    }

    const u = await umbralesVigentes();
    return {
        capturas,
        equipos: equipos.map((e) => ({
            id: e.id, nombre: e.name, ip: e.ip, tipo: String(e.deviceType), ubicacion: e.location,
            ...(cuenta.get(e.id) || { hoy: 0, ultima: null, delEquipo: 0, propias: 0 }),
        })),
        desdeDias: dias,
        recortado: filas.length >= MAX,
        umbrales: { misma: u.misma, parecida: u.parecida, padron: u.padron, pxMin: u.pxMin },
        puede: {
            verFicha: permisos.includes("vision") || permisos.includes("rostros"),
            registrar: permisos.includes("vision.config") || permisos.includes("rostros.listas"),
        },
        pisoManual: pisoManual(u.pxMin),
    };
}

/* ── El resumen del período ─────────────────────────────────────────────────────── */

export type ResumenFace = {
    total: number;
    delEquipo: number;
    negadas: number;
    /** Lo que decidió OmniVision con cada cara. */
    identidades: Record<"padron" | "misma" | "nueva" | "sin-cara", number>;
    /** Por qué quedaron sin comparar. */
    motivos: { chica: number; dudosa: number; motor: number };
    /** Cuántas caras cayeron en cada tramo de tamaño (lib/monitor-face › tramosDeTamano). */
    tamanos: { rotulo: string; n: number; alcanza: boolean }[];
    pxMediana: number | null;
    /** Cuántas identidades distintas pasaron. */
    personas: number;
    pxMin: number;
    calculado: string;
};

/** El resumen se pide cada minuto con la pantalla abierta, y recorre miles de filas: se guarda un rato. */
const CACHE_MS = 60_000;
const cache = new Map<string, { t: number; r: ResumenFace }>();

/**
 * Lo que pasó en el período, sobre TODAS las capturas y no sólo las 400 que se muestran: con el
 * portero del lab son 3.400 por semana, y un resumen de las últimas 400 diría lo del último día.
 * Lo cuenta Postgres leyendo las claves que escribe vision-rostros.js en `details`.
 */
export async function resumenMonitorFace({ dias = 7, deviceId = null as string | null } = {}): Promise<ResumenFace> {
    await sesionConHistorial();
    const clave = `${dias}|${deviceId || ""}`;
    const ya = cache.get(clave);
    if (ya && Date.now() - ya.t < CACHE_MS) return ya.r;

    const ids = (await equiposDeCara()).map((e) => e.id).filter((id) => !deviceId || id === deviceId);
    const desde = new Date(Date.now() - dias * 86_400_000);
    const u = await umbralesVigentes();
    const tramos = tramosDeTamano(u.pxMin);
    const vacio: ResumenFace = {
        total: 0, delEquipo: 0, negadas: 0, identidades: { padron: 0, misma: 0, nueva: 0, "sin-cara": 0 },
        motivos: { chica: 0, dudosa: 0, motor: 0 }, tamanos: tramos.map((t) => ({ rotulo: t.rotulo, n: 0, alcanza: t.hasta > u.pxMin })),
        pxMediana: null, personas: 0, pxMin: u.pxMin, calculado: new Date().toISOString(),
    };
    if (!ids.length) return vacio;

    type Fila = { k: string; m: string | null; n: number };
    const grupos = await prisma.$queryRaw<Fila[]>`
        select case when details ~ 'Source:[[:space:]]*OmniVision' then coalesce(substring(details from 'Identidad:[[:space:]]*([a-z-]+)'), 'sin-cara') else 'equipo' end as k,
               case when details ~ 'SinIdentidad:[[:space:]]*cara chica' then 'chica' when details ~ 'SinIdentidad:[[:space:]]*cara dudosa' then 'dudosa' when details ~ 'SinIdentidad:' then 'motor' end as m,
               count(*)::int as n
        from "AccessEvent" where "deviceId" = any(${ids}::text[]) and "timestamp" >= ${desde}
        group by 1, 2`;
    type Px = { px: number };
    const pxs = await prisma.$queryRaw<Px[]>`
        select substring(details from 'CaraPx:[[:space:]]*([0-9]+)')::int as px
        from "AccessEvent" where "deviceId" = any(${ids}::text[]) and "timestamp" >= ${desde} and details ~ 'CaraPx:[[:space:]]*[0-9]'`;
    const [{ negadas, personas }] = await prisma.$queryRaw<{ negadas: number; personas: number }[]>`
        select count(*) filter (where decision = 'DENY')::int as negadas,
               count(distinct substring(details from 'RostroId:[[:space:]]*([a-z0-9]+)'))::int as personas
        from "AccessEvent" where "deviceId" = any(${ids}::text[]) and "timestamp" >= ${desde}`;

    const r = { ...vacio, negadas, personas };
    for (const g of grupos) {
        r.total += g.n;
        if (g.k === "equipo") { r.delEquipo += g.n; continue; }
        const k = (g.k === "padron" || g.k === "misma" || g.k === "nueva" ? g.k : "sin-cara") as keyof ResumenFace["identidades"];
        r.identidades[k] += g.n;
        if (g.m === "chica") r.motivos.chica += g.n; else if (g.m === "dudosa") r.motivos.dudosa += g.n; else if (g.m === "motor") r.motivos.motor += g.n;
    }
    const orden = pxs.map((x) => x.px).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    r.pxMediana = orden.length ? orden[Math.floor(orden.length / 2)] : null;
    for (const v of orden) {
        const i = tramos.findIndex((t) => v < t.hasta);
        r.tamanos[i < 0 ? tramos.length - 1 : i].n++;
    }
    cache.set(clave, { t: Date.now(), r });
    return r;
}
