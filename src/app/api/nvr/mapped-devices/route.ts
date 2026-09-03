export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/nvr/mapped-devices -> { deviceIds, deviceNames, deviceIps } cámaras cuyo IP está en NVR_CHANNEL_MAP
export async function GET() {
    try {
        const row = await prisma.setting.findUnique({ where: { key: "NVR_CHANNEL_MAP" } });
        if (!row?.value) return NextResponse.json({ deviceIds: [], deviceNames: [], deviceIps: [] });
        const map = JSON.parse(row.value) as Record<string, number | string>;
        const ips = Object.keys(map);
        if (ips.length === 0) return NextResponse.json({ deviceIds: [], deviceNames: [], deviceIps: [] });
        const devs = await prisma.device.findMany({ where: { ip: { in: ips } }, select: { id: true, name: true, ip: true } });
        return NextResponse.json({
            deviceIds: devs.map(d => d.id),
            deviceNames: devs.map(d => d.name).filter(Boolean),
            deviceIps: devs.map(d => d.ip).filter(Boolean),
        });
    } catch {
        return NextResponse.json({ deviceIds: [], deviceNames: [], deviceIps: [] });
    }
}
