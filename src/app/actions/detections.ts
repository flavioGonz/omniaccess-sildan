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
