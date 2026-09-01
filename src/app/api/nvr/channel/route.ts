export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/nvr/channel?deviceId=... -> { channel: number | null }
export async function GET(req: NextRequest) {
    const id = req.nextUrl.searchParams.get("deviceId");
    if (!id) return NextResponse.json({ channel: null });
    try {
        const dev = await prisma.device.findUnique({ where: { id }, select: { ip: true } });
        if (!dev?.ip) return NextResponse.json({ channel: null });
        const row = await prisma.setting.findUnique({ where: { key: "NVR_CHANNEL_MAP" } });
        if (!row?.value) return NextResponse.json({ channel: null });
        const map = JSON.parse(row.value) as Record<string, number | string>;
        const ch = map[dev.ip];
        return NextResponse.json({ channel: ch != null ? Number(ch) : null }, { headers: { "Cache-Control": "no-store" } });
    } catch {
        return NextResponse.json({ channel: null });
    }
}
