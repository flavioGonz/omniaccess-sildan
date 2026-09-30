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

export type IntrusionCam = { id: string; name: string; brand: string; ip: string; nvrName: string | null; nvrId: string | null; ch: number | null };

/** Cámaras para el monitor de intrusión, con su NVR y canal (del NVR_CHANNEL_MAP). */
export async function getIntrusionCameras(): Promise<IntrusionCam[]> {
    const [devices, nvrs, mapRow] = await Promise.all([
        prisma.device.findMany({ where: { deviceType: { in: ["CAMERA", "LPR_CAMERA"] as any } }, select: { id: true, name: true, brand: true, ip: true }, orderBy: { name: "asc" } }),
        prisma.device.findMany({ where: { deviceType: "NVR" }, select: { id: true, name: true } }),
        prisma.setting.findUnique({ where: { key: "NVR_CHANNEL_MAP" } }),
    ]);
    const nvrName: Record<string, string> = {}; nvrs.forEach((n) => (nvrName[n.id] = n.name));
    let map: any = {}; try { map = mapRow ? JSON.parse(mapRow.value) : {}; } catch { }
    return devices.map((d) => {
        const e = map[d.ip]; const nid = e ? (e.nvr || e.nvrId || null) : null;
        return { id: d.id, name: d.name, brand: String(d.brand), ip: d.ip, nvrName: nid ? (nvrName[nid] || null) : null, nvrId: nid, ch: e ? Number(e.ch) : null };
    });
}

type Geom = { line: { x: number; y: number }[]; field: { x: number; y: number }[]; supported: boolean };
const camToScreen = (p: { x: number; y: number }) => ({ x: p.x / 10, y: (1000 - p.y) / 10 });

/** Geometría (línea/zona) de varias cámaras Hik para dibujar mini-overlays en la lista.
 *  Concurrencia limitada; sólo marcas Hikvision (ISAPI Smart). */
export async function getAnalyticsGeometryBatch(ids: string[]): Promise<Record<string, Geom>> {
    const out: Record<string, Geom> = {};
    const list = (ids || []).slice(0, 24);
    if (!list.length) return out;
    const devs = await prisma.device.findMany({ where: { id: { in: list } }, select: { id: true, ip: true, username: true, password: true, authType: true, brand: true } });
    const one = async (d: any) => {
        try {
            if (String(d.brand) !== "HIKVISION") { return; }
            const dev = { ip: d.ip, username: d.username, password: d.password, authType: d.authType || "DIGEST" } as any;
            const sup = await getSmartSupport(dev);
            if (!sup.line && !sup.field) return;
            const line = sup.line ? await readLine(dev, 1) : { points: [] as any[] };
            const field = sup.field ? await readField(dev, 1) : { points: [] as any[] };
            out[d.id] = { supported: true, line: (line.points || []).map(camToScreen), field: (field.points || []).map(camToScreen) };
        } catch { }
    };
    // concurrencia 6
    for (let i = 0; i < devs.length; i += 6) await Promise.all(devs.slice(i, i + 6).map(one));
    return out;
}
