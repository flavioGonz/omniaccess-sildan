/** GET /api/devices/health-history?deviceId=&hours=24 — muestras + alertas recientes de un equipo */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const id = req.nextUrl.searchParams.get("deviceId");
    const hours = Math.min(168, Math.max(1, parseInt(req.nextUrl.searchParams.get("hours") || "24", 10)));
    if (!id) return NextResponse.json({ ok: false, error: "deviceId requerido" }, { status: 400 });
    const since = new Date(Date.now() - hours * 3600 * 1000);
    const [samples, alerts] = await Promise.all([
        prisma.deviceHealthSample.findMany({
            where: { deviceId: id, ts: { gte: since } }, orderBy: { ts: "asc" },
            select: { ts: true, reachable: true, latencyMs: true, memPct: true, driftSec: true, disksOk: true, viewers: true },
        }),
        prisma.deviceAlert.findMany({ where: { deviceId: id }, orderBy: { openedAt: "desc" }, take: 20 }),
    ]);
    // uptime %: fracción de muestras reachable en la ventana
    const up = samples.length ? Math.round((samples.filter((s) => s.reachable).length / samples.length) * 100) : null;
    return NextResponse.json({ ok: true, samples, alerts, uptimePct: up });
}
