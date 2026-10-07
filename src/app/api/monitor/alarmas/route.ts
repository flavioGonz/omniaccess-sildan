import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor, SIN_CACHE } from "@/lib/monitor/servidor";
import { getActiveAlarms, getAttendingIds } from "@/app/actions/detections";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitor/alarmas → las alarmas de intrusión vigentes, para la alerta que se impone
 * sobre cualquier vista: las pendientes (nadie las aceptó) y las confirmadas sin resolver.
 */
export async function GET() {
    const p = await autorizarMonitor("/api/monitor/alarmas");
    if (p.error) return p.error;
    const [pendientes, atendiendoIds] = await Promise.all([getActiveAlarms(), getAttendingIds()]);
    const ids = [...new Set([...pendientes.map((a) => a.deviceId), ...atendiendoIds])];
    const devs = ids.length ? await prisma.device.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const nombre = Object.fromEntries(devs.map((d) => [d.id, d.name]));
    // De cada cámara en atención, la última detección que se aceptó como real: es lo que se muestra.
    const confirmadas = await Promise.all(atendiendoIds.map(async (deviceId) => {
        const d = await prisma.detection.findFirst({ where: { deviceId, acknowledged: true, ackKind: "real", type: { not: "MOTION" } }, orderBy: { timestamp: "desc" }, select: { id: true, type: true, timestamp: true, snapshotPath: true } }).catch(() => null);
        return { deviceId, deviceName: nombre[deviceId] || deviceId, id: d?.id || null, type: d?.type || "OTHER", ts: d ? d.timestamp.toISOString() : null, snapshotPath: d?.snapshotPath || null };
    }));
    return NextResponse.json({
        pendientes: pendientes.map((a) => ({ ...a, deviceName: nombre[a.deviceId] || a.deviceId })),
        confirmadas,
        ahora: new Date().toISOString(),
    }, { headers: SIN_CACHE });
}
