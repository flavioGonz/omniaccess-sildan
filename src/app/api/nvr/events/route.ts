export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/nvr/events?deviceId=<id>&from=<epochMs>&to=<epochMs>
// Devuelve los eventos de UNA cámara dentro de una ventana temporal, para los marcadores del time machine.
export async function GET(req: NextRequest) {
    const sp = req.nextUrl.searchParams;
    const deviceId = sp.get("deviceId");
    const from = parseInt(sp.get("from") || "0");
    const to = parseInt(sp.get("to") || "0");
    if (!deviceId || !from || !to) return NextResponse.json({ events: [] });
    try {
        const events = await prisma.accessEvent.findMany({
            where: {
                deviceId,
                timestamp: { gte: new Date(from), lte: new Date(to) },
            },
            select: {
                id: true,
                timestamp: true,
                plateDetected: true,
                decision: true,
                direction: true,
                accessType: true,
                snapshotPath: true,
                imagePath: true,
            },
            orderBy: { timestamp: "desc" },
            take: 500,
        });
        return NextResponse.json({ events });
    } catch {
        return NextResponse.json({ events: [] });
    }
}
