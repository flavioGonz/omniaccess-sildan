import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getImagePath } from "@/lib/image-path";

export const dynamic = "force-dynamic";

/** GET /api/lpr/evidencia?deviceId=&t=<ms>&limit=  → lecturas LPR de la cámara alrededor de t (la pestaña Evidencia del visor). */
export async function GET(req: NextRequest) {
    const sp = req.nextUrl.searchParams;
    const deviceId = String(sp.get("deviceId") || "");
    if (!deviceId) return NextResponse.json({ items: [] });
    const t = Number(sp.get("t")) || Date.now();
    const limit = Math.min(60, Math.max(1, parseInt(sp.get("limit") || "36", 10) || 36));
    try {
        const filas = await prisma.accessEvent.findMany({
            where: { deviceId, timestamp: { gte: new Date(t - 6 * 3600 * 1000), lte: new Date(t + 2 * 3600 * 1000) } },
            orderBy: { timestamp: "desc" }, take: limit,
            select: { id: true, plateDetected: true, timestamp: true, imagePath: true, snapshotPath: true, decision: true, direction: true },
        });
        const items = filas.map((e) => ({
            id: e.id,
            plate: e.plateDetected && !["unknown", "NO_LEIDA"].includes(e.plateDetected) ? e.plateDetected : null,
            ms: e.timestamp.getTime(),
            url: getImagePath(e.snapshotPath || e.imagePath),
            decision: e.decision, direction: e.direction,
        }));
        return NextResponse.json({ items });
    } catch (e: any) {
        return NextResponse.json({ items: [], error: e?.message }, { status: 500 });
    }
}
