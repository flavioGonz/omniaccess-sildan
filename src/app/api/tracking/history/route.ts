import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/tracking/history
 * Avistamientos de las camaras interiores (los que publica Omni-LPR). Se separan
 * del historial de accesos a proposito: no tienen decision ni abren barrera, asi
 * que mezclarlos con los accesos falsearia el registro de entradas y salidas.
 */
export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    const q = req.nextUrl.searchParams;
    const buscar = (q.get("search") || "").trim();
    const desde = q.get("from");
    const hasta = q.get("to");
    const tomar = Math.min(parseInt(q.get("take") || "50", 10) || 50, 200);
    const saltar = parseInt(q.get("skip") || "0", 10) || 0;

    const donde: any = { source: "TRACK" };
    if (buscar) donde.plate = { contains: buscar.toUpperCase() };
    if (desde || hasta) {
        donde.timestamp = {};
        if (desde) donde.timestamp.gte = new Date(desde);
        if (hasta) { const h = new Date(hasta); h.setHours(23, 59, 59, 999); donde.timestamp.lte = h; }
    }

    const [filas, total] = await Promise.all([
        prisma.plateSighting.findMany({
            where: donde,
            orderBy: { timestamp: "desc" },
            take: tomar,
            skip: saltar,
            select: { id: true, plate: true, deviceId: true, cameraName: true, timestamp: true, confidence: true, snapshotUrl: true, eventType: true, estado: true, estDesde: true, estHasta: true, reads: true },
        }),
        prisma.plateSighting.count({ where: donde }),
    ]);
    return NextResponse.json({ filas, total });
}
