import { NextRequest, NextResponse } from "next/server";
import { autorizarMonitor, SIN_CACHE } from "@/lib/monitor/servidor";
import { prisma } from "@/lib/prisma";
import { getAnalyticsGeometryBatch } from "@/app/actions/detections";
import { verificacionesDe } from "@/lib/verificacion";

/** Cuántas se piden de una vez: lo que entra en una ficha de cámara. */
const MAX_IDS = 40;

/**
 * GET /api/monitor/intrusion/verificacion?ids=a,b — lo que vio omni-vision en esas detecciones,
 * con su veredicto. Para las fichas que abren una detección que no vino en la franja.
 */
export async function GET(req: NextRequest) {
    const p = await autorizarMonitor("/api/monitor/intrusion");
    if (p.error) return p.error;
    const ids = String(req.nextUrl.searchParams.get("ids") || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, MAX_IDS);
    if (!ids.length) return NextResponse.json({}, { headers: SIN_CACHE });
    const devs = await prisma.detection.findMany({ where: { id: { in: ids } }, select: { deviceId: true } });
    const geom = await getAnalyticsGeometryBatch(devs.map((d) => d.deviceId!).filter(Boolean)).catch(() => ({}));
    const v = await verificacionesDe(ids, geom as any);
    return NextResponse.json(Object.fromEntries(v), { headers: SIN_CACHE });
}
