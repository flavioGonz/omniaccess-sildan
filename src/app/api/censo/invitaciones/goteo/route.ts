import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { vueltaDeGoteo } from "@/lib/censo-envio";

export const dynamic = "force-dynamic";

/**
 * GET /api/censo/invitaciones/goteo — una vuelta del envío de a poco. La llama el proceso de
 * despachos cada medio minuto, con `x-tracking-token` (el token interno de siempre). Manda UNA
 * invitación si toca; si no, dice por qué no. No es una ruta para personas.
 */
export async function GET(req: NextRequest) {
    let token = process.env.TRACKING_TOKEN || "";
    if (!token) { try { token = (await prisma.setting.findUnique({ where: { key: "TRACKING_TOKEN" } }))?.value || ""; } catch { /* sin base */ } }
    if (!token || req.headers.get("x-tracking-token") !== token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    try { return NextResponse.json(await vueltaDeGoteo(), { headers: { "Cache-Control": "no-store" } }); }
    catch (e) { return NextResponse.json({ que: "error", error: e instanceof Error ? e.message : "vuelta" }, { status: 500 }); }
}
