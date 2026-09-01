"use server";

import { prisma } from "@/lib/prisma";

const DEFAULT = { mode: "foto", bgUrl: "", photo: [] as any[], geo: [] as any[], center: { lat: -34.9, lng: -56.16, zoom: 14 } };

export async function getMapConfig() {
    const rows = await prisma.setting.findMany({ where: { key: { in: ["MAP_CONFIG", "MAP_BG_URL", "MAP_MARKERS"] } } });
    const m: Record<string, string> = {};
    for (const r of rows) m[r.key] = r.value;
    if (m.MAP_CONFIG) { try { return { ...DEFAULT, ...JSON.parse(m.MAP_CONFIG) }; } catch {} }
    let photo: any[] = [];
    try { photo = m.MAP_MARKERS ? JSON.parse(m.MAP_MARKERS) : []; } catch {}
    return { ...DEFAULT, bgUrl: m.MAP_BG_URL || "", photo };
}

export async function saveMapConfig(cfg: { mode?: string; bgUrl?: string; photo?: any[]; geo?: any[]; center?: any }) {
    const current = await getMapConfig();
    const merged = { ...current, ...cfg };
    await prisma.setting.upsert({ where: { key: "MAP_CONFIG" }, update: { value: JSON.stringify(merged) }, create: { key: "MAP_CONFIG", value: JSON.stringify(merged) } });
    return { ok: true };
}

export async function getMapDevices() {
    const devices = await prisma.device.findMany({
        select: { id: true, name: true, ip: true, deviceType: true, brand: true, lastOnlinePush: true, lastOnlinePull: true },
        orderBy: { name: "asc" },
    });
    const now = Date.now();
    return devices.map((d) => {
        const last = Math.max(d.lastOnlinePush ? +new Date(d.lastOnlinePush) : 0, d.lastOnlinePull ? +new Date(d.lastOnlinePull) : 0);
        return { id: d.id, name: d.name, ip: d.ip || "", type: d.deviceType, brand: d.brand || "", online: last > 0 && now - last < 120000 };
    });
}
