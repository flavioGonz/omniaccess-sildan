export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { registrarCanalNvr } from "@/lib/go2rtc-sync";

/** POST /api/nvr/canal-vivo { nvr, ch } → { ok, id } — prepara el vivo de un canal que no es equipo todavía. */
export async function POST(req: NextRequest) {
    const b = await req.json().catch(() => ({}));
    const nvr = String(b?.nvr || ""); const ch = parseInt(b?.ch);
    if (!nvr || !/^[\w]+$/.test(nvr) || !ch) return NextResponse.json({ ok: false, error: "nvr y ch requeridos" }, { status: 400 });
    const id = await registrarCanalNvr(nvr, ch);
    return id ? NextResponse.json({ ok: true, id }) : NextResponse.json({ ok: false, error: "NVR no encontrado" }, { status: 404 });
}
