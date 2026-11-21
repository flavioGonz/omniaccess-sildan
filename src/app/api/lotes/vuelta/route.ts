import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditarLotes } from "@/lib/lote-auditoria";

export const dynamic = "force-dynamic";

/**
 * GET /api/lotes/vuelta — una pasada de la auditoría de los lotes. La llama el proceso de despachos
 * cada minuto, con `x-tracking-token` (el token interno de siempre). Compara cada lote con su
 * última foto y anota, sin firma, lo que haya cambiado por un camino que no avisó (WhatsApp,
 * Telegram, una importación). No es una ruta para personas.
 */
export async function GET(req: NextRequest) {
    let token = process.env.TRACKING_TOKEN || "";
    if (!token) { try { token = (await prisma.setting.findUnique({ where: { key: "TRACKING_TOKEN" } }))?.value || ""; } catch { /* sin base */ } }
    if (!token || req.headers.get("x-tracking-token") !== token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    return NextResponse.json(await auditarLotes(), { headers: { "Cache-Control": "no-store" } });
}
