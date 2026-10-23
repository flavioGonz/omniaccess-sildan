import { NextResponse } from "next/server";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { leerArbolAreas } from "@/lib/areas-historial";

export const dynamic = "force-dynamic";

/** GET /api/areas — el árbol de áreas de Dispositivos y en qué área está cada equipo (sólo lectura). */
export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    try { return NextResponse.json(await leerArbolAreas(), { headers: { "Cache-Control": "no-store" } }); }
    catch (e: any) { return NextResponse.json({ areas: [], equipoArea: {}, error: e?.message || "No se pudieron leer las áreas." }, { status: 500 }); }
}
