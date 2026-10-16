"use server";

import { prisma } from "@/lib/prisma";
import { verificacionesDe, type Verificacion } from "@/lib/verificacion";
import { pasaVision, type FiltroVision, type Veredicto } from "@/lib/vision-capa";

export type DetItem = {
    id: string;
    deviceId: string | null;
    deviceName: string | null;
    type: string;        // LINECROSS | INTRUSION | REGION_ENTER | REGION_EXIT | MOTION | OTHER
    eventType: string | null;
    snapshotPath: string | null;
    timestamp: string;
    /** Lo que clasificó la cámara: "human" | "vehicle", o "canal N sin mapear" si avisó un NVR. */
    label?: string | null;
    /** Si un operador ya la miró, y qué dijo: "real" | "false". */
    acknowledged?: boolean;
    ackKind?: string | null;
    /** Lo que concluye omni-vision (lo agrega /api/detecciones): null = no la miró. */
    veredicto?: Veredicto | null;
};

/** Últimas detecciones generales (analíticas). Por defecto excluye MOTION (ruidoso). */
export async function getRecentDetections(limit = 40, includeMotion = false, conVeredicto = false): Promise<DetItem[]> {
    const where = includeMotion ? {} : { type: { not: "MOTION" } };
    const rows = await prisma.detection.findMany({ where, orderBy: { timestamp: "desc" }, take: Math.min(150, limit) });
    const ids = [...new Set(rows.map((r) => r.deviceId).filter(Boolean))] as string[];
    const devs = ids.length ? await prisma.device.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    // El veredicto de omni-vision, con la geometría vigente (lib/verificacion): se pide sólo donde se muestra.
    const ver = conVeredicto && rows.length ? await verificacionesDe(rows.map((r) => r.id), await getAnalyticsGeometryBatch(ids).catch(() => ({})) as any).catch(() => new Map()) : null;
    const nmeMap: Record<string, string> = {};
    devs.forEach((d) => (nmeMap[d.id] = d.name));
    return rows.map((r) => ({
        id: r.id,
        deviceId: r.deviceId,
        deviceName: r.deviceId ? nmeMap[r.deviceId] || null : null,
        type: r.type,
        eventType: r.eventType,
        snapshotPath: r.snapshotPath,
        timestamp: r.timestamp.toISOString(),
        label: r.label,
        acknowledged: r.acknowledged,
        ackKind: r.ackKind,
        ...(ver ? { veredicto: ver.get(r.id)?.veredicto ?? null } : {}),
    }));
}

/** Pasado este silencio, una cámara de intrusión se marca como "callada" en el resumen. */
const CALLADA_MS = 24 * 3600 * 1000;

export type ResumenDetecciones = {
    /** Desde la medianoche del barrio, por tipo. */
    hoy: Record<string, number>;
    /** Últimas 24 h, por tipo. */
    dia: Record<string, number>;
    /** Cada cámara que puede detectar, con su última detección. */
    camaras: { id: string; nombre: string; ultima: string | null; dia: number; callada: boolean }[];
};

/** Medianoche de hoy en la zona del barrio, como instante. */
function medianocheDelBarrio(): Date {
    const zona = process.env.NEXT_PUBLIC_TZ || "America/Montevideo";
    const ahora = new Date();
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
    // "GMT-03:00": el desfasaje de la zona en ese día, sin escribirlo a mano.
    const gmt = new Intl.DateTimeFormat("en-US", { timeZone: zona, timeZoneName: "longOffset" }).formatToParts(ahora).find((x) => x.type === "timeZoneName")?.value || "GMT";
    const desfase = gmt === "GMT" ? "Z" : gmt.replace("GMT", "");
    return new Date(`${ymd}T00:00:00${desfase}`);
}

/**
 * Los contadores del cajón de Detecciones, contados en la base y no sobre las 30 filas que
 * se muestran: "12 cruces" tiene que ser 12 cruces de verdad, no los que entraron en la lista.
 *
 * Y la última detección de cada cámara, que es lo que faltaba para ver una cámara muda: la
 * LPR Interior estuvo 30 horas sin avisar (su regla de cruce quedó apagada) y desde el
 * panel sólo se veía una lista que no crecía, igual que en una noche tranquila.
 */
export async function resumenDetecciones(): Promise<ResumenDetecciones> {
    const desdeHoy = medianocheDelBarrio();
    const desdeDia = new Date(Date.now() - 24 * 3600 * 1000);
    const sinMovimiento = { type: { not: "MOTION" } };
    const [hoy, dia, camaras, ultimas, porCamDia] = await Promise.all([
        prisma.detection.groupBy({ by: ["type"], where: { ...sinMovimiento, timestamp: { gte: desdeHoy } }, _count: { _all: true } }),
        prisma.detection.groupBy({ by: ["type"], where: { ...sinMovimiento, timestamp: { gte: desdeDia } }, _count: { _all: true } }),
        prisma.device.findMany({ where: { deviceType: { in: ["CAMERA", "LPR_INTERIOR"] as any } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
        prisma.detection.groupBy({ by: ["deviceId"], where: { ...sinMovimiento, deviceId: { not: null } }, _max: { timestamp: true } }),
        prisma.detection.groupBy({ by: ["deviceId"], where: { ...sinMovimiento, deviceId: { not: null }, timestamp: { gte: desdeDia } }, _count: { _all: true } }),
    ]);
    const aMapa = (filas: { type: string; _count: { _all: number } }[]) => Object.fromEntries(filas.map((f) => [f.type, f._count._all]));
    const ultima = new Map(ultimas.map((u) => [u.deviceId as string, u._max.timestamp]));
    const cuenta = new Map(porCamDia.map((u) => [u.deviceId as string, u._count._all]));
    return {
        hoy: aMapa(hoy as any),
        dia: aMapa(dia as any),
        camaras: camaras.map((c) => {
            const u = ultima.get(c.id) || null;
            return { id: c.id, nombre: c.name, ultima: u ? u.toISOString() : null, dia: cuenta.get(c.id) || 0, callada: !u || Date.now() - u.getTime() > CALLADA_MS };
        }),
    };
}

/** IDs de dispositivos que emitieron analíticas en los últimos 7 días (para colorear su icono). */
export async function getDevicesWithAnalytics(): Promise<string[]> {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    try {
        const rows = await prisma.detection.findMany({
            where: { timestamp: { gte: since }, deviceId: { not: null } },
            select: { deviceId: true },
            distinct: ["deviceId"],
        });
        return rows.map((r) => r.deviceId!).filter(Boolean);
    } catch {
        return [];
    }
}


import { getSmartSupport, readLine, readField } from "@/lib/isapi-analytics";
import { resolveForCamera } from "@/lib/nvr-resolve";
import { readDahuaIvs } from "@/lib/dahua-ivs";

export type IntrusionCam = {
    id: string; name: string; brand: string; ip: string; nvrName: string | null; nvrId: string | null; ch: number | null; alarmOk?: boolean;
    /** CAMERA o LPR_INTERIOR: la interior se calibra en el calibrador de pantalla completa. */
    tipo?: string;
    /** Si tiene RTSP (la URL no viaja: lleva la clave). */
    tieneRtsp?: boolean;
};

/** Cámaras para el monitor de intrusión, con su NVR y canal (del NVR_CHANNEL_MAP). */
export async function getIntrusionCameras(): Promise<IntrusionCam[]> {
    const [devices, nvrs, mapRow] = await Promise.all([
        // CAMERA (canales importados de un NVR) y LPR_INTERIOR: en San Nicolás las
        // perimetrales son AcuSense que a la vez alimentan el seguimiento por RTSP y vigilan
        // una línea. La capa de intrusión no es exclusiva de un tipo: es cualquier cámara
        // que pueda clasificar cruces/zonas a bordo.
        prisma.device.findMany({ where: { deviceType: { in: ["CAMERA", "LPR_INTERIOR"] as any } }, select: { id: true, name: true, brand: true, ip: true, deviceType: true, rtspUrl: true }, orderBy: { name: "asc" } }),
        prisma.device.findMany({ where: { deviceType: "NVR" }, select: { id: true, name: true } }),
        prisma.setting.findUnique({ where: { key: "NVR_CHANNEL_MAP" } }),
    ]);
    const alarmRow = await prisma.setting.findUnique({ where: { key: "ALARM_CONFIGURED_IPS" } });
    let alarmSet = new Set<string>(); try { alarmSet = new Set(JSON.parse(alarmRow?.value || "[]")); } catch { }
    const nvrName: Record<string, string> = {}; nvrs.forEach((n) => (nvrName[n.id] = n.name));
    let map: any = {}; try { map = mapRow ? JSON.parse(mapRow.value) : {}; } catch { }
    return devices.map((d) => {
        const e = map[d.ip]; const nid = e ? (e.nvr || e.nvrId || null) : null;
        return { id: d.id, name: d.name, brand: String(d.brand), ip: d.ip, nvrName: nid ? (nvrName[nid] || null) : null, nvrId: nid, ch: e ? Number(e.ch) : null, alarmOk: alarmSet.has(d.ip), tipo: String(d.deviceType), tieneRtsp: !!d.rtspUrl };
    });
}

type Geom = { line: { x: number; y: number }[]; field: { x: number; y: number }[]; supported: boolean };
const camToScreen = (p: { x: number; y: number }) => ({ x: p.x / 10, y: (1000 - p.y) / 10 });

// Cache en memoria de la geometría por dispositivo (evita re-consultar las NVR/cámaras en cada carga de la grilla).
type GeomCacheEntry = { geom: Geom; ts: number };
const GEOM_CACHE = new Map<string, GeomCacheEntry>();
const GEOM_TTL = 5 * 60 * 1000;

/** Geometría (línea/zona) de varias cámaras para dibujar overlays en la grilla.
 *  Sirve de cache lo fresco y sólo consulta los dispositivos vencidos; concurrencia limitada. */
export async function getAnalyticsGeometryBatch(ids: string[], fresco = false): Promise<Record<string, Geom>> {
    const out: Record<string, Geom> = {};
    const list = [...new Set((ids || []).filter(Boolean))];
    if (!list.length) return out;
    const now = Date.now();
    const stale: string[] = [];
    for (const id of list) {
        const c = GEOM_CACHE.get(id);
        // `fresco`: se acaba de calibrar; el caché de 5 min mostraría la línea vieja (o la borrada).
        if (!fresco && c && now - c.ts < GEOM_TTL) out[id] = c.geom; else stale.push(id);
    }
    if (!stale.length) return out;
    const devs = await prisma.device.findMany({ where: { id: { in: stale } }, select: { id: true, ip: true, username: true, password: true, authType: true, brand: true } });
    const empty: Geom = { line: [], field: [], supported: false };
    const one = async (d: any) => {
        const store = (g: Geom) => { out[d.id] = g; GEOM_CACHE.set(d.id, { geom: g, ts: Date.now() }); };
        try {
            // Canal detrás de una NVR Dahua: leer IVS por configManager (ya viene en 0–1000)
            const cam = await resolveForCamera(d.id);
            if (cam && String((cam.nvr as any).brand).toUpperCase() === "DAHUA") {
                const r = await readDahuaIvs({ ip: cam.nvr.ip, user: cam.nvr.user, pass: cam.nvr.pass }, cam.ch);
                store((r.line.length || r.field.length)
                    ? { supported: true, line: r.line.map(camToScreen), field: r.field.map(camToScreen) }
                    : empty);
                return;
            }
            if (String(d.brand) !== "HIKVISION") { store(empty); return; }
            const dev = { ip: d.ip, username: d.username, password: d.password, authType: d.authType || "DIGEST" } as any;
            const sup = await getSmartSupport(dev);
            if (!sup.line && !sup.field) { store(empty); return; }
            const line = sup.line ? await readLine(dev, 1) : { enabled: false, points: [] as any[] };
            const field = sup.field ? await readField(dev, 1) : { enabled: false, points: [] as any[] };
            // Sólo lo que está PRENDIDO: una regla apagada conserva sus coordenadas en la cámara, y
            // dibujarlas en el vivo hacía creer que la línea seguía vigilando (9/10: la de la LPR
            // Interior se quitó y seguía apareciendo en el vivo del monitor de intrusión).
            store({ supported: true, line: line.enabled ? (line.points || []).map(camToScreen) : [], field: field.enabled ? (field.points || []).map(camToScreen) : [] });
        } catch { /* transitorio: no cachear, reintentar en la próxima carga */ }
    };
    for (let i = 0; i < devs.length; i += 6) await Promise.all(devs.slice(i, i + 6).map(one));
    return out;
}


export type DetHistItem = { id: string; deviceId: string | null; deviceName: string | null; nvrName: string | null; ch: number | null; type: string; eventType: string | null; snapshotPath: string | null; timestamp: string; acknowledged?: boolean; ackKind?: string | null; label?: string | null;
    /** Con `conVeredicto`: lo que concluye omni-vision con la geometría vigente (null = no la miró). */
    veredicto?: Veredicto | null };

/**
 * Con filtro por veredicto, cuántas de las más recientes (que cumplen el resto del filtro) se
 * miran. El veredicto no está en la base —depende de dónde está HOY la línea de la cámara— y se
 * calcula al pedir; medido el 10/10 hay 138 analizadas en total, así que la ventana sobra por
 * meses. Si se llena, la respuesta lo dice (`truncado`, con el tamaño de la ventana) en vez de
 * dar un total falso.
 */
const VENTANA_VEREDICTO = 2000;

/** Historial paginado de detecciones (para la vista tipo /admin/history de intrusión). */
export async function getDetectionHistory(opts: { page?: number; pageSize?: number; type?: string; deviceId?: string; from?: string; to?: string; ack?: "pending" | "done" | "all"; vision?: FiltroVision; conVeredicto?: boolean } = {}): Promise<{ items: DetHistItem[]; total: number; page: number; pageSize: number; truncado?: number }> {
    const page = Math.max(0, opts.page ?? 0);
    const size = Math.min(100, opts.pageSize ?? 40);
    const where: any = {};
    if (opts.type && opts.type !== "ALL") {
        if (opts.type === "ANALYTIC") where.type = { not: "MOTION" };
        else where.type = opts.type;
    }
    if (opts.deviceId) where.deviceId = opts.deviceId;
    if (opts.ack === "pending") where.acknowledged = false;
    else if (opts.ack === "done") where.acknowledged = true;
    const _ts: any = {};
    if (opts.from) { const f = new Date(opts.from); if (!isNaN(f.getTime())) _ts.gte = f; }
    if (opts.to) { const t = new Date(opts.to); if (!isNaN(t.getTime())) _ts.lte = t; }
    if (Object.keys(_ts).length) where.timestamp = _ts;
    const vision = opts.vision || "todas";
    // «Sin analizar» se contesta en la base: es no tener verificación OK (o ninguna).
    if (vision === "sin") where.OR = [{ verifEstado: null }, { verifEstado: { not: "OK" } }];
    let rows: any[], total: number, truncado = 0;
    let veredictos = new Map<string, Verificacion>();
    if (vision === "alguien" || vision === "nadie") {
        // El veredicto se calcula: se traen las analizadas de la ventana, se decide y se pagina acá.
        const cand = await prisma.detection.findMany({ where: { ...where, verifEstado: "OK" }, orderBy: { timestamp: "desc" }, take: VENTANA_VEREDICTO, select: { id: true, deviceId: true } });
        truncado = cand.length === VENTANA_VEREDICTO ? VENTANA_VEREDICTO : 0;
        const geom = await getAnalyticsGeometryBatch([...new Set(cand.map((c) => c.deviceId).filter(Boolean))] as string[]).catch(() => ({}));
        veredictos = await verificacionesDe(cand.map((c) => c.id), geom as any);
        const pasan = cand.filter((c) => pasaVision(veredictos.get(c.id)?.veredicto, vision)).map((c) => c.id);
        total = pasan.length;
        const pagina = pasan.slice(page * size, (page + 1) * size);
        rows = pagina.length ? await prisma.detection.findMany({ where: { id: { in: pagina } }, orderBy: { timestamp: "desc" } }) : [];
    } else {
        [rows, total] = await Promise.all([
            prisma.detection.findMany({ where, orderBy: { timestamp: "desc" }, skip: page * size, take: size }),
            prisma.detection.count({ where }),
        ]);
        if (opts.conVeredicto && rows.length) {
            const geom = await getAnalyticsGeometryBatch([...new Set(rows.map((r) => r.deviceId).filter(Boolean))] as string[]).catch(() => ({}));
            veredictos = await verificacionesDe(rows.map((r) => r.id), geom as any).catch(() => new Map());
        }
    }
    const ids = [...new Set(rows.map((r) => r.deviceId).filter(Boolean))] as string[];
    const [devs, nvrs, mapRow] = await Promise.all([
        ids.length ? prisma.device.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, ip: true } }) : Promise.resolve([] as any[]),
        prisma.device.findMany({ where: { deviceType: "NVR" }, select: { id: true, name: true } }),
        prisma.setting.findUnique({ where: { key: "NVR_CHANNEL_MAP" } }),
    ]);
    const dm: Record<string, { name: string; ip: string }> = {}; devs.forEach((d: any) => (dm[d.id] = { name: d.name, ip: d.ip }));
    const nvrName: Record<string, string> = {}; nvrs.forEach((n) => (nvrName[n.id] = n.name));
    let map: any = {}; try { map = mapRow ? JSON.parse(mapRow.value) : {}; } catch { }
    const items = rows.map((r) => {
        const d = r.deviceId ? dm[r.deviceId] : null;
        const e = d ? map[d.ip] : null; const nid = e ? (e.nvr || e.nvrId || null) : null;
        const item: DetHistItem = { id: r.id, deviceId: r.deviceId, deviceName: d?.name || null, nvrName: nid ? (nvrName[nid] || null) : null, ch: e ? Number(e.ch) : null, type: r.type, eventType: r.eventType, snapshotPath: r.snapshotPath, timestamp: r.timestamp.toISOString(), acknowledged: r.acknowledged, ackKind: r.ackKind, label: r.label };
        if (opts.conVeredicto || vision !== "todas") item.veredicto = veredictos.get(r.id)?.veredicto ?? null;
        return item;
    });
    return { items, total, page, pageSize: size, ...(truncado ? { truncado } : {}) };
}


export type ActiveAlarm = { deviceId: string; id: string; type: string; ts: string };

/** Alarmas de intrusión sin aceptar (para reconstruir los overlays al recargar la página). */
export async function getActiveAlarms(): Promise<ActiveAlarm[]> {
    const since = new Date(Date.now() - 6 * 3600 * 1000);
    try {
        const rows = await prisma.detection.findMany({
            where: { acknowledged: false, type: { not: "MOTION" }, timestamp: { gte: since }, deviceId: { not: null } },
            orderBy: { timestamp: "desc" }, take: 300,
            select: { id: true, deviceId: true, type: true, timestamp: true },
        });
        return rows.map((r) => ({ deviceId: r.deviceId!, id: r.id, type: r.type, ts: r.timestamp.toISOString() }));
    } catch { return []; }
}

/** Acepta (o marca falsa alarma) las detecciones sin aceptar de un canal. */
// ── Canales "en atención": evento confirmado REAL y aún sin resolver (borde animado) ──
export async function getAttendingIds(): Promise<string[]> {
    try { const r = await prisma.setting.findUnique({ where: { key: "INTRUSION_ATTENDING_IDS" } }); return JSON.parse(r?.value || "[]"); } catch { return []; }
}
export async function setAttending(deviceId: string, on: boolean): Promise<{ ok: boolean }> {
    try {
        const r = await prisma.setting.findUnique({ where: { key: "INTRUSION_ATTENDING_IDS" } });
        let set: Set<string>; try { set = new Set(JSON.parse(r?.value || "[]")); } catch { set = new Set(); }
        if (on) set.add(deviceId); else set.delete(deviceId);
        const value = JSON.stringify([...set]);
        await prisma.setting.upsert({ where: { key: "INTRUSION_ATTENDING_IDS" }, update: { value }, create: { key: "INTRUSION_ATTENDING_IDS", value } });
        // La barra de «intrusión real» de todas las pantallas y el monitor se enteran al instante.
        try { const { avisarPorSocket } = await import("@/lib/avisar"); avisarPorSocket("intrusion_atencion", { deviceId, on }); } catch { }
        return { ok: true };
    } catch { return { ok: false }; }
}

export type IntrusionConfirmada = { deviceId: string; deviceName: string; id: string | null; type: string; label: string | null; ts: string | null; snapshotPath: string | null };
/**
 * Las intrusiones confirmadas como reales y sin resolver, con la detección que se aceptó: lo que
 * muestra la barra roja de todo el panel (AlertaIntrusionGlobal) y la pared (/api/monitor/alarmas).
 */
export async function getIntrusionesConfirmadas(): Promise<IntrusionConfirmada[]> {
    const ids = await getAttendingIds();
    if (!ids.length) return [];
    const devs = await prisma.device.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }).catch(() => []);
    const nombre = Object.fromEntries(devs.map((d) => [d.id, d.name]));
    return Promise.all(ids.map(async (deviceId) => {
        const d = await prisma.detection.findFirst({ where: { deviceId, acknowledged: true, ackKind: "real", type: { not: "MOTION" } }, orderBy: { timestamp: "desc" }, select: { id: true, type: true, label: true, timestamp: true, snapshotPath: true } }).catch(() => null);
        return { deviceId, deviceName: nombre[deviceId] || deviceId, id: d?.id || null, type: d?.type || "OTHER", label: d?.label || null, ts: d ? d.timestamp.toISOString() : null, snapshotPath: d?.snapshotPath || null };
    }));
}

// ── Visual Track: enlaces entre cámaras de la misma escena (seguir intrusos) ──
// Registro: Setting VISUAL_TRACK_LINKS = { [camId]: Array<{to,x,y}> }  (x,y en 0..1 sobre el video)
export type TrackLink = { to: string; x: number; y: number };
export async function getVisualTrackLinks(camId: string): Promise<TrackLink[]> {
    try {
        const r = await prisma.setting.findUnique({ where: { key: "VISUAL_TRACK_LINKS" } });
        const all = JSON.parse(r?.value || "{}");
        const arr = Array.isArray(all?.[camId]) ? all[camId] : [];
        return arr.filter((l: any) => l && typeof l.to === "string").map((l: any) => ({ to: String(l.to), x: Number(l.x) || 0.5, y: Number(l.y) || 0.5 }));
    } catch { return []; }
}
export async function setVisualTrackLinks(camId: string, links: TrackLink[]): Promise<{ ok: boolean }> {
    // Una acción del servidor se puede llamar desde afuera de la pantalla: sin sesión no se escribe
    // (antes no se miraba, y cualquiera con el id de la acción podía reescribir los enlaces).
    const { getSession } = await import("@/app/actions/auth");
    if (!(await getSession().catch(() => null))) return { ok: false };
    if (typeof camId !== "string" || !/^[\w-]{1,100}$/.test(camId)) return { ok: false };
    try {
        const r = await prisma.setting.findUnique({ where: { key: "VISUAL_TRACK_LINKS" } });
        let all: Record<string, TrackLink[]>; try { all = JSON.parse(r?.value || "{}"); } catch { all = {}; }
        const clean = (links || []).filter((l) => l && l.to).map((l) => ({ to: String(l.to), x: Math.max(0, Math.min(1, Number(l.x) || 0.5)), y: Math.max(0, Math.min(1, Number(l.y) || 0.5)) }));
        if (clean.length) all[camId] = clean; else delete all[camId];
        const value = JSON.stringify(all);
        await prisma.setting.upsert({ where: { key: "VISUAL_TRACK_LINKS" }, update: { value }, create: { key: "VISUAL_TRACK_LINKS", value } });
        return { ok: true };
    } catch { return { ok: false }; }
}

export async function getTodayIntrusionCounts(): Promise<Record<string, number>> {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    try {
        const rows = await prisma.detection.groupBy({ by: ["deviceId"], where: { type: { not: "MOTION" }, timestamp: { gte: start }, deviceId: { not: null } }, _count: { _all: true } });
        const out: Record<string, number> = {};
        for (const r of rows) if (r.deviceId) out[r.deviceId] = (r._count as any)._all;
        return out;
    } catch { return {}; }
}

/**
 * Reclasificar como falsa una intrusión que ya se había confirmado como real.
 *
 * Existe porque la confirmación se toma rápido —el modal se confirma solo a los 20 s— y el
 * operador recién después, con la foto grande delante, ve que era un perro o una rama. Sin
 * esto, la única salida de "en atención" era "resuelto", y el registro quedaba diciendo que
 * hubo una intrusión real donde no la hubo. Toca sólo lo aceptado como real en las últimas
 * 6 horas de esa cámara, igual que la ventana de `ackAlarms`.
 */
export async function reclasificarComoFalsa(deviceId: string): Promise<{ ok: boolean; count: number }> {
    const since = new Date(Date.now() - 6 * 3600 * 1000);
    try {
        const r = await prisma.detection.updateMany({
            where: { deviceId, acknowledged: true, ackKind: "real", type: { not: "MOTION" }, timestamp: { gte: since } },
            data: { ackKind: "false", ackAt: new Date() },
        });
        return { ok: true, count: r.count };
    } catch { return { ok: false, count: 0 }; }
}

/**
 * Corregir UNA detección: real o falsa alarma. Las otras acciones de esta pantalla van por
 * cámara (aceptan todo lo pendiente de un canal); esta es para el registro de un evento ya
 * mirado — "esa de las 09:20 no era nadie" — sin tocar las demás.
 */
export async function marcarDeteccion(id: string, kind: "real" | "false"): Promise<{ ok: boolean; error?: string }> {
    const { getSession } = await import("@/app/actions/auth");
    if (!(await getSession())) return { ok: false, error: "Hace falta una sesión del panel." };
    if (kind !== "real" && kind !== "false") return { ok: false, error: "Estado inválido" };
    try {
        await prisma.detection.update({ where: { id }, data: { acknowledged: true, ackKind: kind, ackAt: new Date() } });
        return { ok: true };
    } catch { return { ok: false, error: "No se encontró la detección" }; }
}

export async function ackAlarms(deviceId: string, kind: "real" | "false" = "real"): Promise<{ ok: boolean; count: number }> {
    const since = new Date(Date.now() - 6 * 3600 * 1000);
    try {
        const r = await prisma.detection.updateMany({
            where: { deviceId, acknowledged: false, type: { not: "MOTION" }, timestamp: { gte: since } },
            data: { acknowledged: true, ackKind: kind, ackAt: new Date() },
        });
        return { ok: true, count: r.count };
    } catch { return { ok: false, count: 0 }; }
}

/**
 * Una pieza de evidencia de un canal, venga de donde venga.
 *  · analitica — lo que avisó la cámara o el NVR (Detection): cruce de línea, intrusión…
 *  · lectura   — una matrícula que leyó la cámara o el motor (AccessEvent).
 *  · objeto    — lo que OmniVision siguió en el canal (ObjetoVisto): auto, persona, perro…
 */
export type EvidenciaItem = {
    id: string; origen: "analitica" | "lectura" | "objeto"; ts: string;
    /** Rótulo corto: «Cruce de línea», «Matrícula ABC1234», «Auto». */
    titulo: string; detalle: string | null; foto: string | null;
    /** Para la analítica: el tipo (LINECROSS…), con el que la pantalla elige ícono y tono. */
    tipo: string | null;
};

/**
 * La pestaña Evidencia de la ficha de una cámara. Antes leía sólo Detection, que es lo que manda
 * la analítica de la cámara: una LPR que OmniVision mira no manda analítica, así que la pestaña
 * decía «Sin capturas de evidencia» con 17 lecturas y 408 objetos guardados de esa misma cámara
 * (medido el 16/10 en LPR Interior del lab). Ahora junta las tres fuentes por hora.
 */
export async function getEvidenciaCamara(deviceId: string, limite = 60): Promise<EvidenciaItem[]> {
    const { getSession } = await import("@/app/actions/auth");
    if (!(await getSession().catch(() => null))) return [];
    if (typeof deviceId !== "string" || !/^[\w-]{1,100}$/.test(deviceId)) return [];
    const n = Math.max(1, Math.min(150, limite));
    const { NOMBRE_CLASE_REGLA } = await import("@/lib/vision-reglas");
    const [dets, lecturas, objetos] = await Promise.all([
        prisma.detection.findMany({ where: { deviceId }, orderBy: { timestamp: "desc" }, take: n }).catch(() => []),
        prisma.accessEvent.findMany({ where: { deviceId }, orderBy: { timestamp: "desc" }, take: n, select: { id: true, timestamp: true, plateDetected: true, direction: true, decision: true, snapshotPath: true, imagePath: true } }).catch(() => []),
        prisma.objetoVisto.findMany({ where: { deviceId }, orderBy: { primeraVez: "desc" }, take: n, select: { id: true, primeraVez: true, clase: true, confianza: true, foto: true, recorte: true, cuadros: true } }).catch(() => []),
    ]);
    const NOMBRE_TIPO: Record<string, string> = { LINECROSS: "Cruce de línea", INTRUSION: "Intrusión", REGION_ENTER: "Entra a zona", REGION_EXIT: "Sale de zona", MOTION: "Movimiento" };
    const items: EvidenciaItem[] = [
        ...dets.map((d: any) => ({ id: `d:${d.id}`, origen: "analitica" as const, ts: d.timestamp.toISOString(), titulo: NOMBRE_TIPO[d.type] || "Evento", detalle: d.label || null, foto: d.snapshotPath || `/api/snapshot/${deviceId}?t=${d.id}`, tipo: d.type })),
        ...lecturas.map((e) => ({
            id: `l:${e.id}`, origen: "lectura" as const, ts: e.timestamp.toISOString(),
            titulo: e.plateDetected && !/^NO_?LEID[AO]$/i.test(e.plateDetected) ? e.plateDetected : "Sin leer",
            detalle: [e.direction === "ENTRY" ? "Entrada" : e.direction === "EXIT" ? "Salida" : null, e.decision === "DENY" ? "Denegada" : null].filter(Boolean).join(" · ") || null,
            foto: e.snapshotPath || e.imagePath || null, tipo: null,
        })),
        ...objetos.map((o) => ({
            id: `o:${o.id}`, origen: "objeto" as const, ts: o.primeraVez.toISOString(),
            titulo: NOMBRE_CLASE_REGLA[o.clase] || o.clase, detalle: `${Math.round(o.confianza * 100)} % · ${o.cuadros} cuadros`,
            foto: o.foto ? `/api/vision/imagen/${o.foto}?w=640` : o.recorte ? `/api/vision/imagen/${o.recorte}` : null, tipo: null,
        })),
    ];
    return items.sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, n);
}
