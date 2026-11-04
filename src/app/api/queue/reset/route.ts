import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resetQueueCounters } from "@/lib/onvif-polling";
import { exigirTokenInterno } from "@/lib/token-interno";

// GET /api/queue/reset?deviceId=  → reset queue counters (in-memory + emit 0 events)
export async function GET(req: NextRequest) {
    const no = await exigirTokenInterno(req); if (no) return no;
    try {
        const deviceId = req.nextUrl.searchParams.get("deviceId");
        const devices = deviceId
            ? await prisma.device.findMany({ where: { id: deviceId }, select: { id: true } })
            : await prisma.device.findMany({ where: { deviceType: "QUEUE_COUNTER" }, select: { id: true } });
        const now = new Date();
        for (const d of devices) {
            try { resetQueueCounters(d.id); } catch {}
            for (const ch of ["Aforo", "Entrada", "Salida"]) {
                await prisma.queueEvent.create({
                    data: { deviceId: d.id, channelName: ch, channelId: 1, peopleCount: 0, timestamp: now, metadata: JSON.stringify({ source: "reset" }) },
                });
            }
        }
        return NextResponse.json({ status: "ok", reset: devices.length, at: now.toISOString() });
    } catch (e: any) {
        return NextResponse.json({ status: "error", message: e.message }, { status: 500 });
    }
}

// Poner en cero cambia estado: se acepta también por POST (lo recomendado). El GET queda por
// compatibilidad, con el mismo token.
export const POST = GET;
