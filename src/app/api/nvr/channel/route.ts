export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getChannelMap } from "@/lib/nvr-resolve";

// GET /api/nvr/channel?deviceId=... -> { channel: number | null, nvr: nvrId | null }
export async function GET(req: NextRequest) {
    const id = req.nextUrl.searchParams.get("deviceId");
    if (!id) return NextResponse.json({ channel: null, nvr: null });
    try {
        const dev = await prisma.device.findUnique({ where: { id }, select: { ip: true } });
        if (!dev?.ip) return NextResponse.json({ channel: null, nvr: null });
        const map = await getChannelMap();
        const e = map[dev.ip];
        return NextResponse.json({ channel: e?.ch ?? null, nvr: e?.nvrId ?? null }, { headers: { "Cache-Control": "no-store" } });
    } catch {
        return NextResponse.json({ channel: null, nvr: null });
    }
}
