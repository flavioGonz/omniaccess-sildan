import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { clipDeInstante, PERMISOS_VIDEO, type Para } from "@/lib/clip-instante";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// El corte puede esperar a que el tramo se grabe y el NVR entrega a tiempo real.
export const maxDuration = 120;

/**
 * POST /api/clip/instante { deviceId, instante, antes?, despues?, para?, matricula? }
 *
 * Lo llama el worker de despachos (proceso aparte, sin sesión) para la alerta con video, con
 * el mismo `x-tracking-token` que /api/notifications/event. También lo acepta una sesión con
 * permiso de ver video. Vive bajo /api/clip/, que el middleware deja pasar para que WhatsApp
 * baje los archivos; por eso la verificación está acá y no allá.
 */
async function autorizado(req: NextRequest): Promise<boolean> {
    let token = process.env.TRACKING_TOKEN || "";
    if (!token) { try { token = (await prisma.setting.findUnique({ where: { key: "TRACKING_TOKEN" } }))?.value || ""; } catch { } }
    if (token && req.headers.get("x-tracking-token") === token) return true;
    try {
        const s: any = await getSession();
        if (!s) return false;
        const perms = permisosDeSesion(s);
        return PERMISOS_VIDEO.some((p) => perms.includes(p));
    } catch { return false; }
}

export async function POST(req: NextRequest) {
    if (!(await autorizado(req))) return NextResponse.json({ ok: false, motivo: "No autorizado" }, { status: 401 });
    const b: any = await req.json().catch(() => ({}));
    const deviceId = String(b?.deviceId || "");
    const instante = typeof b?.instante === "number" ? b.instante : Date.parse(String(b?.instante || ""));
    if (!deviceId || !Number.isFinite(instante)) return NextResponse.json({ ok: false, motivo: "Falta la cámara o el instante" }, { status: 400 });
    const para: Para = b?.para === "envio" ? "envio" : "alerta";
    const r = await clipDeInstante({ deviceId, instante, antes: b?.antes, despues: b?.despues, para, matricula: b?.matricula || null });
    // Sin clip no es un error del pedido: es un resultado con su motivo (la alerta va con foto).
    if (!r.ok) return NextResponse.json(r);
    const { archivo: _archivo, ...publico } = r;
    return NextResponse.json(publico);
}
