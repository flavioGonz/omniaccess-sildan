import { prisma } from "@/lib/prisma";
import { diaYNoche, pct, peoresHoras, sugerencias, type Hora, type Sugerencia } from "@/lib/tasa-lectura";

/**
 * Medir la tasa de lectura de cada cámara (26/11): la pantalla y el Excel salen de acá.
 *
 * Dos grupos, cada uno con SU denominador (ver la ruta /api/lpr/read-rate):
 *  · Accesos — las LPR de barrera (entrada y salida): capturas del ANPR, leídas vs. NO_LEIDA. Se suma
 *    cuántas de las que la cámara no leyó leyó después OmniVision: es la mejor pista de un ANPR mal
 *    ajustado.
 *  · Interiores — lo que lee OmniVision (la pasarela: ráfagas vs. ráfagas con lectura, con lo que
 *    explica una tasa baja: escena, zona, cuota, reconexiones) y las LPR de sentido Interior que leen
 *    con su propio ANPR.
 * Una cámara puede aparecer dos veces (ANPR y OmniVision): son dos mediciones distintas.
 */
export type CamaraTasa = {
    deviceId: string | null; name: string; metodo: "anpr" | "omnivision"; direction: string | null;
    total: number; read: number; unread: number; ratePct: number | null;
    horas: Hora[]; peores: Hora[]; dia: number | null; noche: number | null;
    recuperadas?: number; fueraDeLinea?: number; frenados?: number; descartes?: number; minutosEscenaPct?: number | null; reconexiones?: number;
    lecturasUnicas?: number; ultima: string | null; sugerencias: Sugerencia[];
};
export type GrupoTasa = { overall: { total: number; read: number; unread: number; ratePct: number | null }; camaras: CamaraTasa[]; perHour: Hora[]; hayDatos: boolean };
export type Tasas = { days: number; desde: string; generado: string; accesos: GrupoTasa; interiores: GrupoTasa };

const vacias = (): Hora[] => Array.from({ length: 24 }, (_, h) => ({ hour: h, total: 0, read: 0, ratePct: null }));
const cerrar = (hs: Hora[]) => hs.map((h) => ({ ...h, ratePct: pct(h.read, h.total) }));

function grupo(camaras: CamaraTasa[]): GrupoTasa {
    const perHour = vacias();
    for (const c of camaras) for (const h of c.horas) { perHour[h.hour].total += h.total; perHour[h.hour].read += h.read; }
    const total = camaras.reduce((s, c) => s + c.total, 0), read = camaras.reduce((s, c) => s + c.read, 0);
    return { overall: { total, read, unread: total - read, ratePct: pct(read, total) }, camaras: camaras.sort((a, b) => (a.ratePct ?? 101) - (b.ratePct ?? 101)), perHour: cerrar(perHour), hayDatos: camaras.length > 0 };
}

export async function medirTasas(days: number): Promise<Tasas> {
    const since = new Date(Date.now() - days * 86_400_000);
    const ahora = Date.now();

    // ── ANPR (barrera e interiores con ANPR propio), por cámara y por hora ──
    const anpr: { deviceId: string | null; name: string | null; direction: string | null; hr: number; total: number; read: number; ultima: Date | null }[] = await prisma.$queryRaw`
        SELECT e."deviceId" AS "deviceId", d."name" AS name, d."direction"::text AS direction,
               EXTRACT(HOUR FROM (e."timestamp" AT TIME ZONE 'America/Montevideo'))::int AS hr,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE e."plateDetected" IS NOT NULL AND e."plateDetected" NOT IN ('NO_LEIDA','unknown','UNKNOWN','S/P',''))::int AS read,
               MAX(e."timestamp") AS ultima
        FROM "AccessEvent" e LEFT JOIN "Device" d ON d."id" = e."deviceId"
        WHERE e."accessType" = 'PLATE' AND e."timestamp" >= ${since} AND e."sinVehiculo" = false
          -- Las que escribe la pasarela por una interior que mira un acceso no son capturas del ANPR.
          AND COALESCE(e.details, '') NOT LIKE '%RTSP Detect%'
        GROUP BY e."deviceId", d."name", d."direction", hr`;
    const recuperadas: { deviceId: string | null; n: number }[] = await prisma.$queryRaw`
        SELECT e."deviceId" AS "deviceId", COUNT(*)::int AS n
        FROM "AccessEvent" e JOIN "Relectura" r ON r."accessEventId" = e.id
        WHERE e."accessType" = 'PLATE' AND e."timestamp" >= ${since} AND e."sinVehiculo" = false
          AND r.estado IN ('LEIDA', 'DUDOSA') AND COALESCE((r.candidatos->>'doble')::boolean, false) = false
        GROUP BY e."deviceId"`;
    const recPor = new Map(recuperadas.map((r) => [r.deviceId, Number(r.n)]));

    const porCam = new Map<string, CamaraTasa & { _ultima: Date | null }>();
    for (const r of anpr) {
        // Una cámara que ya no existe no se puede corregir: sus capturas viejas no van a la lista.
        if (!r.name) continue;
        const k = `anpr:${r.deviceId}`;
        let c = porCam.get(k);
        if (!c) { c = { deviceId: r.deviceId, name: r.name || "Cámara borrada", metodo: "anpr", direction: r.direction, total: 0, read: 0, unread: 0, ratePct: null, horas: vacias(), peores: [], dia: null, noche: null, ultima: null, sugerencias: [], recuperadas: recPor.get(r.deviceId) || 0, _ultima: null }; porCam.set(k, c); }
        c.total += Number(r.total); c.read += Number(r.read);
        c.horas[Number(r.hr)].total += Number(r.total); c.horas[Number(r.hr)].read += Number(r.read);
        if (r.ultima && (!c._ultima || r.ultima > c._ultima)) c._ultima = r.ultima;
    }

    // ── OmniVision (la pasarela), por cámara y por hora ──
    const ov: { deviceId: string; name: string | null; direction: string | null; hr: number; disparos: number; lecturas: number; descartes: number; fuera: number; frenados: number; reconexiones: number; minutos: number; escena: number; ultima: Date | null }[] = await prisma.$queryRaw`
        SELECT m."deviceId" AS "deviceId", COALESCE(d."name", MAX(m."nombre")) AS name, d."direction"::text AS direction,
               EXTRACT(HOUR FROM (m."momento" AT TIME ZONE 'America/Montevideo'))::int AS hr,
               SUM(m."disparos")::int AS disparos, SUM(m."lecturas")::int AS lecturas, SUM(m."descartes")::int AS descartes,
               SUM(m."fueraDeLinea")::int AS fuera, SUM(m."frenados")::int AS frenados, SUM(m."reconexiones")::int AS reconexiones,
               COUNT(*)::int AS minutos, COUNT(*) FILTER (WHERE m."modo" = 'escena')::int AS escena,
               MAX(m."momento") FILTER (WHERE m."lecturas" > 0) AS ultima
        FROM "TrackingCamaraMuestra" m LEFT JOIN "Device" d ON d."id" = m."deviceId"
        WHERE m."momento" >= ${since}
        GROUP BY m."deviceId", d."name", d."direction", hr`;
    const unicas: { deviceId: string; n: number }[] = await prisma.$queryRaw`
        SELECT "deviceId", COUNT(DISTINCT plate)::int AS n FROM "PlateSighting"
        WHERE source = 'TRACK' AND timestamp >= ${since} AND "deviceId" IS NOT NULL GROUP BY "deviceId"`;
    const unPor = new Map(unicas.map((u) => [u.deviceId, Number(u.n)]));
    const minutos = new Map<string, { tot: number; escena: number }>();
    for (const r of ov) {
        const k = `ov:${r.deviceId}`;
        let c = porCam.get(k);
        if (!c) { c = { deviceId: r.deviceId, name: r.name || "Cámara borrada", metodo: "omnivision", direction: r.direction, total: 0, read: 0, unread: 0, ratePct: null, horas: vacias(), peores: [], dia: null, noche: null, ultima: null, sugerencias: [], fueraDeLinea: 0, frenados: 0, descartes: 0, reconexiones: 0, lecturasUnicas: unPor.get(r.deviceId) || 0, _ultima: null }; porCam.set(k, c); }
        c.total += Number(r.disparos); c.read += Number(r.lecturas);
        c.descartes! += Number(r.descartes); c.fueraDeLinea! += Number(r.fuera); c.frenados! += Number(r.frenados); c.reconexiones! += Number(r.reconexiones);
        c.horas[Number(r.hr)].total += Number(r.disparos); c.horas[Number(r.hr)].read += Number(r.lecturas);
        const m = minutos.get(k) || { tot: 0, escena: 0 }; m.tot += Number(r.minutos); m.escena += Number(r.escena); minutos.set(k, m);
        if (r.ultima && (!c._ultima || r.ultima > c._ultima)) c._ultima = r.ultima;
    }

    const accesos: CamaraTasa[] = [], interiores: CamaraTasa[] = [];
    for (const [k, c0] of porCam) {
        const { _ultima, ...c } = c0;
        c.unread = c.total - c.read; c.ratePct = pct(c.read, c.total); c.horas = cerrar(c.horas);
        c.peores = peoresHoras(c.horas); const dn = diaYNoche(c.horas); c.dia = dn.dia; c.noche = dn.noche;
        c.ultima = _ultima ? _ultima.toISOString() : null;
        if (c.metodo === "omnivision") { const m = minutos.get(k); c.minutosEscenaPct = m && m.tot ? pct(m.escena, m.tot) : null; }
        c.sugerencias = sugerencias({ ...c, silencioMin: _ultima ? Math.round((ahora - _ultima.getTime()) / 60000) : null });
        (c.metodo === "omnivision" || c.direction === "INTERIOR" ? interiores : accesos).push(c);
    }
    return { days, desde: since.toISOString(), generado: new Date().toISOString(), accesos: grupo(accesos), interiores: grupo(interiores) };
}
