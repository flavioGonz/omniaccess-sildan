"use server";

import { prisma } from "@/lib/prisma";

export type DetItem = {
    id: string;
    deviceId: string | null;
    deviceName: string | null;
    type: string;        // LINECROSS | INTRUSION | REGION_ENTER | REGION_EXIT | MOTION | OTHER
    eventType: string | null;
    snapshotPath: string | null;
    timestamp: string;
};

/** Últimas detecciones generales (analíticas). Por defecto excluye MOTION (ruidoso). */
export async function getRecentDetections(limit = 40, includeMotion = false): Promise<DetItem[]> {
    const where = includeMotion ? {} : { type: { not: "MOTION" } };
    const rows = await prisma.detection.findMany({ where, orderBy: { timestamp: "desc" }, take: Math.min(150, limit) });
    const ids = [...new Set(rows.map((r) => r.deviceId).filter(Boolean))] as string[];
    const devs = ids.length ? await prisma.device.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
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
    }));
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

export type IntrusionCam = { id: string; name: string; brand: string; ip: string; nvrName: string | null; nvrId: string | null; ch: number | null; alarmOk?: boolean };

/** Cámaras para el monitor de intrusión, con su NVR y canal (del NVR_CHANNEL_MAP). */
export async function getIntrusionCameras(): Promise<IntrusionCam[]> {
    const [devices, nvrs, mapRow] = await Promise.all([
        prisma.device.findMany({ where: { deviceType: "CAMERA" as any }, select: { id: true, name: true, brand: true, ip: true }, orderBy: { name: "asc" } }),
        prisma.device.findMany({ where: { deviceType: "NVR" }, select: { id: true, name: true } }),
        prisma.setting.findUnique({ where: { key: "NVR_CHANNEL_MAP" } }),
    ]);
    const alarmRow = await prisma.setting.findUnique({ where: { key: "ALARM_CONFIGURED_IPS" } });
    let alarmSet = new Set<string>(); try { alarmSet = new Set(JSON.parse(alarmRow?.value || "[]")); } catch { }
    const nvrName: Record<string, string> = {}; nvrs.forEach((n) => (nvrName[n.id] = n.name));
    let map: any = {}; try { map = mapRow ? JSON.parse(mapRow.value) : {}; } catch { }
    return devices.map((d) => {
        const e = map[d.ip]; const nid = e ? (e.nvr || e.nvrId || null) : null;
        return { id: d.id, name: d.name, brand: String(d.brand), ip: d.ip, nvrName: nid ? (nvrName[nid] || null) : null, nvrId: nid, ch: e ? Number(e.ch) : null, alarmOk: alarmSet.has(d.ip) };
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
export async function getAnalyticsGeometryBatch(ids: string[]): Promise<Record<string, Geom>> {
    const out: Record<string, Geom> = {};
    const list = [...new Set((ids || []).filter(Boolean))];
    if (!list.length) return out;
    const now = Date.now();
    const stale: string[] = [];
    for (const id of list) {
        const c = GEOM_CACHE.get(id);
        if (c && now - c.ts < GEOM_TTL) out[id] = c.geom; else stale.push(id);
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
            const line = sup.line ? await readLine(dev, 1) : { points: [] as any[] };
            const field = sup.field ? await readField(dev, 1) : { points: [] as any[] };
            store({ supported: true, line: (line.points || []).map(camToScreen), field: (field.points || []).map(camToScreen) });
        } catch { /* transitorio: no cachear, reintentar en la próxima carga */ }
    };
    for (let i = 0; i < devs.length; i += 6) await Promise.all(devs.slice(i, i + 6).map(one));
    return out;
}


export type DetHistItem = { id: string; deviceId: string | null; deviceName: string | null; nvrName: string | null; ch: number | null; type: string; eventType: string | null; snapshotPath: string | null; timestamp: string; acknowledged?: boolean; ackKind?: string | null; label?: string | null };

/** Historial paginado de detecciones (para la vista tipo /admin/history de intrusión). */
export async function getDetectionHistory(opts: { page?: number; pageSize?: number; type?: string; deviceId?: string; from?: string; to?: string; ack?: "pending" | "done" | "all" } = {}): Promise<{ items: DetHistItem[]; total: number; page: number; pageSize: number }> {
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
    const [rows, total] = await Promise.all([
        prisma.detection.findMany({ where, orderBy: { timestamp: "desc" }, skip: page * size, take: size }),
        prisma.detection.count({ where }),
    ]);
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
        return { id: r.id, deviceId: r.deviceId, deviceName: d?.name || null, nvrName: nid ? (nvrName[nid] || null) : null, ch: e ? Number(e.ch) : null, type: r.type, eventType: r.eventType, snapshotPath: r.snapshotPath, timestamp: r.timestamp.toISOString(), acknowledged: r.acknowledged, ackKind: r.ackKind, label: r.label };
    });
    return { items, total, page, pageSize: size };
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
        return { ok: true };
    } catch { return { ok: false }; }
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
