import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { tick } from "@/lib/visitas/tick";

export const dynamic = "force-dynamic";

/**
 * GET /api/visitas/tick — lo llama el cron del CT cada minuto, con `x-tracking-token` (el
 * mismo token interno de /api/notifications/event). Vence visitas, avisa permanencias,
 * cierra el día y recalcula perfiles. Ver lib/visitas/tick.
 */
export async function GET(req: NextRequest) {
    let token = process.env.TRACKING_TOKEN || "";
    if (!token) { try { token = (await prisma.setting.findUnique({ where: { key: "TRACKING_TOKEN" } }))?.value || ""; } catch { } }
    if (!token || req.headers.get("x-tracking-token") !== token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    try {
        return NextResponse.json({ ok: true, ...(await tick({ forzarPerfiles: req.nextUrl.searchParams.get("perfiles") === "1" })) });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "tick" }, { status: 500 });
    }
}
