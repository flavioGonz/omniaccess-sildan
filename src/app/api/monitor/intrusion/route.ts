import { NextResponse } from "next/server";
import { autorizarMonitor, SIN_CACHE } from "@/lib/monitor/servidor";
import { getIntrusionCameras, getAnalyticsGeometryBatch, getRecentDetections, getDetectionHistory, getActiveAlarms, getAttendingIds } from "@/app/actions/detections";
import { horariosDeTodas } from "@/lib/horarios-camaras";
import { prisma } from "@/lib/prisma";
import { inicioDelDia } from "@/lib/monitor/servidor";

export const dynamic = "force-dynamic";

/**
 * Cuántas detecciones recientes van en la franja lateral. Eran 12 y no se podían mover; con
 * la franja táctil (se desliza y se filtra) doce no alcanzan para que un filtro muestre algo.
 */
const ULTIMAS_EN_FRANJA = 40;

/**
 * GET /api/monitor/intrusion → todo lo que la vista Intrusión dibuja: cámaras con su
 * geometría y su armado, última detección por cámara, alarmas pendientes y confirmadas, y
 * las últimas detecciones para la franja. Una sola llamada: la pared la repite cada 30 s.
 */
export async function GET() {
    const p = await autorizarMonitor("/api/monitor/intrusion");
    if (p.error) return p.error;
    const camaras = await getIntrusionCameras();
    const ids = camaras.map((c) => c.id);
    const hoy = { timestamp: { gte: inicioDelDia() }, type: { not: "MOTION" } };
    const [geom, horarios, recientes, franja, pendientes, atendiendo, hoyTotal, hoyReales, hoyFalsas] = await Promise.all([
        getAnalyticsGeometryBatch(ids).catch(() => ({})),
        horariosDeTodas().catch(() => ({})),
        getRecentDetections(80, false).catch(() => []),
        getDetectionHistory({ pageSize: ULTIMAS_EN_FRANJA, type: "ANALYTIC" }).then((r) => r.items).catch(() => []),
        getActiveAlarms().catch(() => []),
        getAttendingIds().catch(() => []),
        // Los contadores de la barra, contados en la base (no sobre la franja cargada).
        prisma.detection.count({ where: hoy }).catch(() => 0),
        prisma.detection.count({ where: { ...hoy, acknowledged: true, ackKind: "real" } }).catch(() => 0),
        prisma.detection.count({ where: { ...hoy, acknowledged: true, ackKind: "false" } }).catch(() => 0),
    ]);
    const ultimaPorCamara: Record<string, any> = {};
    for (const d of recientes) if (d.deviceId && !ultimaPorCamara[d.deviceId]) ultimaPorCamara[d.deviceId] = d;
    return NextResponse.json({
        camaras: camaras.map((c) => ({ ...c, geom: (geom as any)[c.id] || null, horarios: (horarios as any)[c.id] || null, ultima: ultimaPorCamara[c.id] || null })),
        pendientes, atendiendo, franja, ahora: new Date().toISOString(),
        hoy: { total: hoyTotal, reales: hoyReales, falsas: hoyFalsas },
    }, { headers: SIN_CACHE });
}
