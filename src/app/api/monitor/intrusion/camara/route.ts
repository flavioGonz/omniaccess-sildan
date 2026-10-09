import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor, inicioDelDia, SIN_CACHE } from "@/lib/monitor/servidor";
import { getDetectionHistory } from "@/app/actions/detections";

export const dynamic = "force-dynamic";

/** Cuántas detecciones de la cámara trae la ficha. */
const DETECCIONES_EN_FICHA = 30;

/**
 * GET /api/monitor/intrusion/camara?id=<deviceId> → lo que muestra la ficha de una cámara en
 * la pared táctil: sus últimas detecciones (con estado) y cuántas lleva hoy. Cae dentro del
 * alcance de la vista Intrusión (`/api/monitor/intrusion…`), así que un enlace de pantalla
 * de esa vista la puede leer; no escribe nada.
 */
export async function GET(req: NextRequest) {
    const p = await autorizarMonitor("/api/monitor/intrusion/camara");
    if (p.error) return p.error;
    const id = req.nextUrl.searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "Falta la cámara" }, { status: 400 });
    const hoy = { deviceId: id, timestamp: { gte: inicioDelDia() }, type: { not: "MOTION" } };
    const [hist, total, reales, falsas] = await Promise.all([
        getDetectionHistory({ deviceId: id, type: "ANALYTIC", pageSize: DETECCIONES_EN_FICHA }).catch(() => ({ items: [] as any[] })),
        prisma.detection.count({ where: hoy }).catch(() => 0),
        prisma.detection.count({ where: { ...hoy, acknowledged: true, ackKind: "real" } }).catch(() => 0),
        prisma.detection.count({ where: { ...hoy, acknowledged: true, ackKind: "false" } }).catch(() => 0),
    ]);
    return NextResponse.json({ detecciones: hist.items, hoy: { total, reales, falsas } }, { headers: SIN_CACHE });
}
