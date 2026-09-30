/**
 * /api/devices/alarm-host?deviceId=...
 *  GET  → { hosts, hasOmni } estado del servidor de alarma del equipo
 *  POST → asegura OmniAccess como servidor de alarma (lo agrega si falta)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readAlarmHosts, ensureAlarmHost, testAlarmHost } from "@/lib/isapi-alarmhost";

export const dynamic = "force-dynamic";

async function load(id: string) {
    const d = await prisma.device.findUnique({ where: { id }, select: { id: true, ip: true, username: true, password: true, authType: true } });
    return d ? { ...d, authType: d.authType || "DIGEST" } : null;
}

export async function GET(req: NextRequest) {
    const id = req.nextUrl.searchParams.get("deviceId");
    if (!id) return NextResponse.json({ ok: false, error: "deviceId requerido" }, { status: 400 });
    const d = await load(id);
    if (!d) return NextResponse.json({ ok: false, error: "device no existe" }, { status: 404 });
    const r = await readAlarmHosts(d as any);
    return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
    const id = req.nextUrl.searchParams.get("deviceId");
    if (!id) return NextResponse.json({ ok: false, error: "deviceId requerido" }, { status: 400 });
    const d = await load(id);
    if (!d) return NextResponse.json({ ok: false, error: "device no existe" }, { status: 404 });
    if (req.nextUrl.searchParams.get("action") === "test") {
        const t = await testAlarmHost(d as any);
        return NextResponse.json(t, { status: t.ok ? 200 : 502 });
    }
    const r = await ensureAlarmHost(d as any);
    return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
