"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { limitesPorFila, EPISODIO_UNION_SEG } from "@/lib/filas/demora";
import { configRetencion } from "@/lib/filas/retencion";
import {
    CANAL_ENTRADA, CANAL_SALIDA, LIMITE_FILA_POR_DEFECTO, AJUSTE_FOTOS_DIAS, AJUSTE_FOTOS_COMPLETAS_DIAS, FOTOS_DIAS_MAX,
} from "@/lib/filas/constantes";

/**
 * Flujo de filas y el historial de capturas (HB, 19/10).
 *
 * Lo que había (getQueueAforoSeries + getQueueEvents) mezclaba el aforo con los contadores de
 * Entrada/Salida, que son acumulados de la cámara: la gráfica decía «pico 93» en una fila que
 * nunca pasó de 7. Acá el aforo es sólo el canal de aforo, y los cruces van por separado.
 */

async function exigirSesion() {
    const s = await getSession();
    if (!s) throw new Error("Necesitás iniciar sesión");
}

export type Rango = "24h" | "7d" | "30d";
/** Largo del rango y del tramo de la gráfica. 96 puntos en 24 h: uno cada 15 min, foto incluida. */
const RANGOS: Record<Rango, { ms: number; tramo: string; tramoMs: number }> = {
    "24h": { ms: 24 * 3600_000, tramo: "15 minutes", tramoMs: 15 * 60_000 },
    "7d": { ms: 7 * 24 * 3600_000, tramo: "2 hours", tramoMs: 2 * 3600_000 },
    "30d": { ms: 30 * 24 * 3600_000, tramo: "8 hours", tramoMs: 8 * 3600_000 },
};
/** Cortes más cortos que esto no se dibujan: son la cámara tardando en contestar, no una caída. */
const CORTE_MINIMO_SEG = 120;
/** Tope de veces sobre el límite que se listan (las más recientes). */
const EPISODIOS_MAX = 200;

const ORIGEN = "timestamp '2000-01-01 00:00:00'";

export type PuntoFlujo = {
    t: string; prom: number; max: number; lecturas: number; entradas: number; salidas: number;
    foto: { ruta: string; personas: number; t: string } | null;
};
export type Episodio = {
    deviceId: string; fila: string; limite: number;
    desde: string; hasta: string | null; segundos: number; pico: number; picoA: string | null;
    foto: string | null; numero: number;
};

export async function getFlujoFilas(p: { deviceId?: string | null; rango: Rango }) {
    await exigirSesion();
    const r = RANGOS[p.rango] || RANGOS["24h"];
    const ahora = new Date();
    const desde = new Date(ahora.getTime() - r.ms);
    const dev = p.deviceId || null;

    const [devices, limites] = await Promise.all([
        prisma.device.findMany({ where: { deviceType: "QUEUE_COUNTER" }, select: { id: true, name: true, ip: true, location: true }, orderBy: { name: "asc" } }),
        limitesPorFila(),
    ]);
    const nombre = Object.fromEntries(devices.map((d) => [d.id, d.name]));
    const limiteDe = (id: string) => limites[id] ?? LIMITE_FILA_POR_DEFECTO;

    const [tramos, fotos, cortes] = await Promise.all([
        prisma.$queryRawUnsafe<any[]>(`
            select date_bin($1::interval, "timestamp", ${ORIGEN}) as t,
                coalesce(max("peopleCount") filter (where "channelName" not in ($2, $3)), 0)::int as max,
                coalesce(avg("peopleCount") filter (where "channelName" not in ($2, $3)), 0)::float as prom,
                (count(*) filter (where "channelName" not in ($2, $3)))::int as lecturas,
                (count(*) filter (where "channelName" = $2))::int as entradas,
                (count(*) filter (where "channelName" = $3))::int as salidas
            from "QueueEvent"
            where "timestamp" >= $4 and ($5::text is null or "deviceId" = $5)
            group by 1 order by 1`, r.tramo, CANAL_ENTRADA, CANAL_SALIDA, desde, dev),
        prisma.$queryRawUnsafe<any[]>(`
            select distinct on (date_bin($1::interval, "timestamp", ${ORIGEN}))
                date_bin($1::interval, "timestamp", ${ORIGEN}) as t, "snapshotPath" as ruta, "peopleCount" as personas, "timestamp" as ts
            from "QueueEvent"
            where "timestamp" >= $2 and "snapshotPath" is not null and "channelName" not in ($3, $4)
              and ($5::text is null or "deviceId" = $5)
            order by date_bin($1::interval, "timestamp", ${ORIGEN}), "peopleCount" desc, "timestamp" desc`, r.tramo, desde, CANAL_ENTRADA, CANAL_SALIDA, dev),
        prisma.cameraOutage.findMany({
            where: { OR: [{ endedAt: null }, { endedAt: { gte: desde } }], ...(dev ? { deviceId: dev } : {}) },
            select: { id: true, deviceId: true, startedAt: true, endedAt: true, durationSec: true },
            orderBy: { startedAt: "asc" },
        }),
    ]);

    // La serie completa (con tramos vacíos), para que la gráfica no salte de un dato al otro.
    const porTramo = new Map<number, any>(tramos.map((x) => [new Date(x.t).getTime(), x]));
    const fotoTramo = new Map<number, any>(fotos.map((x) => [new Date(x.t).getTime(), x]));
    const inicio = Math.floor((desde.getTime() - Date.UTC(2000, 0, 1)) / r.tramoMs) * r.tramoMs + Date.UTC(2000, 0, 1);
    const puntos: PuntoFlujo[] = [];
    for (let t = inicio; t <= ahora.getTime(); t += r.tramoMs) {
        const x = porTramo.get(t), f = fotoTramo.get(t);
        puntos.push({
            t: new Date(t).toISOString(),
            prom: x ? Math.round(x.prom * 10) / 10 : 0, max: x?.max ?? 0, lecturas: x?.lecturas ?? 0,
            entradas: x?.entradas ?? 0, salidas: x?.salidas ?? 0,
            foto: f ? { ruta: f.ruta, personas: f.personas, t: new Date(f.ts).toISOString() } : null,
        });
    }

    const episodios = await episodiosSobreLimite({ desde, deviceId: dev, limites, nombre });
    const sobreSeg = episodios.reduce((s, e) => s + e.segundos, 0);
    const lecturas = puntos.reduce((s, x) => s + x.lecturas, 0);
    const pico = puntos.reduce<{ v: number; t: string | null }>((m, x) => (x.max > m.v ? { v: x.max, t: x.t } : m), { v: 0, t: null });
    const conDatos = puntos.filter((x) => x.lecturas > 0);
    return {
        rango: p.rango, tramoMs: r.tramoMs,
        filas: devices.map((d) => ({ ...d, limite: limiteDe(d.id) })),
        limite: dev ? limiteDe(dev) : Math.min(...devices.map((d) => limiteDe(d.id)), LIMITE_FILA_POR_DEFECTO),
        puntos, episodios,
        cortes: cortes
            .map((c) => ({ ...c, seg: c.durationSec ?? Math.round((ahora.getTime() - c.startedAt.getTime()) / 1000) }))
            .filter((c) => c.seg >= CORTE_MINIMO_SEG)
            .map((c) => ({ desde: c.startedAt.toISOString(), hasta: c.endedAt?.toISOString() || null, seg: c.seg, fila: nombre[c.deviceId] || "" })),
        resumen: {
            lecturas, pico: pico.v, picoA: pico.t,
            prom: conDatos.length ? Math.round((conDatos.reduce((s, x) => s + x.prom, 0) / conDatos.length) * 10) / 10 : 0,
            entradas: puntos.reduce((s, x) => s + x.entradas, 0),
            salidas: puntos.reduce((s, x) => s + x.salidas, 0),
            vecesSobre: episodios.length, sobreSeg,
        },
    };
}

/**
 * Las veces que cada fila llegó a su límite: desde que llega hasta que baja, uniendo las bajadas
 * de menos de EPISODIO_UNION_SEG (la cámara parpadea en el borde de la zona; la fila no se vació).
 */
async function episodiosSobreLimite(p: { desde: Date; deviceId: string | null; limites: Record<string, number>; nombre: Record<string, string> }): Promise<Episodio[]> {
    const lim = JSON.stringify(Object.entries(p.limites).map(([id, l]) => ({ id, lim: l })));
    const cambios = await prisma.$queryRawUnsafe<{ deviceId: string; ts: Date; sobre: boolean; personas: number }[]>(`
        with lim as (select * from json_to_recordset($1::json) as l(id text, lim int)),
        ev as (
            select e."deviceId", e."timestamp" as ts, e."peopleCount" as personas,
                (e."peopleCount" >= coalesce(l.lim, $2::int)) as sobre
            from "QueueEvent" e left join lim l on l.id = e."deviceId"
            where e."timestamp" >= $3 and e."channelName" not in ($4, $5) and ($6::text is null or e."deviceId" = $6)
        ),
        t as (select *, lag(sobre) over (partition by "deviceId" order by ts) as antes from ev)
        select "deviceId", ts, sobre, personas from t where sobre is distinct from coalesce(antes, false)
        order by "deviceId", ts`, lim, LIMITE_FILA_POR_DEFECTO, p.desde, CANAL_ENTRADA, CANAL_SALIDA, p.deviceId);

    const crudos: { deviceId: string; desde: Date; hasta: Date | null }[] = [];
    for (const c of cambios) {
        const ult = crudos[crudos.length - 1];
        if (c.sobre) {
            // Volvió a llegar enseguida: es el mismo episodio.
            if (ult && ult.deviceId === c.deviceId && ult.hasta && c.ts.getTime() - ult.hasta.getTime() < EPISODIO_UNION_SEG * 1000) ult.hasta = null;
            else crudos.push({ deviceId: c.deviceId, desde: c.ts, hasta: null });
        } else if (ult && ult.deviceId === c.deviceId && !ult.hasta) ult.hasta = c.ts;
    }
    const recientes = crudos.slice(-EPISODIOS_MAX);
    const numeroBase = crudos.length - recientes.length;
    const ahora = Date.now();
    const out = await Promise.all(recientes.map(async (e, i) => {
        const hasta = e.hasta || new Date(ahora);
        const [picoEv, fotoEv] = await Promise.all([
            prisma.queueEvent.findFirst({
                where: { deviceId: e.deviceId, timestamp: { gte: e.desde, lte: hasta }, NOT: { channelName: { in: [CANAL_ENTRADA, CANAL_SALIDA] } } },
                orderBy: [{ peopleCount: "desc" }, { timestamp: "asc" }], select: { peopleCount: true, timestamp: true },
            }),
            prisma.queueEvent.findFirst({
                where: { deviceId: e.deviceId, timestamp: { gte: e.desde, lte: hasta }, snapshotPath: { not: null }, NOT: { channelName: { in: [CANAL_ENTRADA, CANAL_SALIDA] } } },
                orderBy: [{ peopleCount: "desc" }, { timestamp: "asc" }], select: { snapshotPath: true },
            }),
        ]);
        return {
            deviceId: e.deviceId, fila: p.nombre[e.deviceId] || "Fila", limite: p.limites[e.deviceId] ?? LIMITE_FILA_POR_DEFECTO,
            desde: e.desde.toISOString(), hasta: e.hasta?.toISOString() || null,
            segundos: Math.max(0, Math.round((hasta.getTime() - e.desde.getTime()) / 1000)),
            pico: picoEv?.peopleCount ?? 0, picoA: picoEv?.timestamp.toISOString() || null,
            foto: fotoEv?.snapshotPath || null, numero: numeroBase + i + 1,
        } satisfies Episodio;
    }));
    return out.reverse(); // la más reciente arriba
}

/** Las filas con su límite, liviano (para los filtros). */
export async function getFilasConLimite() {
    await exigirSesion();
    const [devices, limites] = await Promise.all([
        prisma.device.findMany({ where: { deviceType: "QUEUE_COUNTER" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
        limitesPorFila(),
    ]);
    return devices.map((d) => ({ ...d, limite: limites[d.id] ?? LIMITE_FILA_POR_DEFECTO }));
}

/* ── Lecturas y capturas ─────────────────────────────────────────────────────── */

export type Lectura = { id: string; t: string; fila: string; deviceId: string; canal: string; personas: number; foto: string | null; limite: number };

export async function getLecturasFilas(p: {
    deviceId?: string | null; desde?: string | null; hasta?: string | null; minPersonas?: number | null;
    soloConFoto?: boolean; soloAforo?: boolean; pagina?: number; porPagina?: number;
}) {
    await exigirSesion();
    const porPagina = Math.min(Math.max(p.porPagina || 50, 10), 200);
    const pagina = Math.max(p.pagina || 0, 0);
    const where: any = {
        device: { deviceType: "QUEUE_COUNTER" },
        ...(p.deviceId ? { deviceId: p.deviceId } : {}),
        ...(p.soloConFoto ? { snapshotPath: { not: null } } : {}),
        ...(p.soloAforo || p.soloConFoto ? { NOT: { channelName: { in: [CANAL_ENTRADA, CANAL_SALIDA] } } } : {}),
        ...(p.minPersonas ? { peopleCount: { gte: p.minPersonas } } : {}),
        ...((p.desde || p.hasta) ? { timestamp: { ...(p.desde ? { gte: new Date(p.desde) } : {}), ...(p.hasta ? { lte: new Date(p.hasta) } : {}) } } : {}),
    };
    const [total, filas, limites] = await Promise.all([
        prisma.queueEvent.count({ where }),
        prisma.queueEvent.findMany({
            where, orderBy: { timestamp: "desc" }, skip: pagina * porPagina, take: porPagina,
            select: { id: true, timestamp: true, channelName: true, peopleCount: true, snapshotPath: true, deviceId: true, device: { select: { name: true } } },
        }),
        limitesPorFila(),
    ]);
    return {
        total, pagina, porPagina,
        lecturas: filas.map((e) => ({
            id: e.id, t: e.timestamp.toISOString(), fila: e.device?.name || "Fila", deviceId: e.deviceId,
            canal: e.channelName || "Aforo", personas: e.peopleCount, foto: e.snapshotPath,
            limite: limites[e.deviceId] ?? LIMITE_FILA_POR_DEFECTO,
        })) as Lectura[],
    };
}

/* ── Retención de fotos ──────────────────────────────────────────────────────── */

export async function getRetencionFotos() {
    await exigirSesion();
    const cfg = await configRetencion();
    const [conFoto, primera] = await Promise.all([
        prisma.queueEvent.count({ where: { snapshotPath: { not: null } } }),
        prisma.queueEvent.findFirst({ where: { snapshotPath: { not: null } }, orderBy: { timestamp: "asc" }, select: { timestamp: true } }),
    ]);
    return { ...cfg, conFoto, primera: primera?.timestamp.toISOString() || null, maxDias: FOTOS_DIAS_MAX };
}

export async function guardarRetencionFotos(d: { dias: number; completasDias: number }) {
    const s = await getSession();
    if (!s) throw new Error("Necesitás iniciar sesión");
    const dias = Math.min(FOTOS_DIAS_MAX, Math.max(1, Math.round(Number(d.dias) || 0)));
    const completas = Math.min(dias, Math.max(0, Math.round(Number(d.completasDias) || 0)));
    await prisma.$transaction([
        prisma.setting.upsert({ where: { key: AJUSTE_FOTOS_DIAS }, update: { value: String(dias) }, create: { key: AJUSTE_FOTOS_DIAS, value: String(dias) } }),
        prisma.setting.upsert({ where: { key: AJUSTE_FOTOS_COMPLETAS_DIAS }, update: { value: String(completas) }, create: { key: AJUSTE_FOTOS_COMPLETAS_DIAS, value: String(completas) } }),
    ]);
    return { dias, completasDias: completas };
}
