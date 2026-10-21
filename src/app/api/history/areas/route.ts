import { NextResponse } from "next/server";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { leerAreasHistorial } from "@/lib/areas-historial";

export const dynamic = "force-dynamic";

/** GET /api/history/areas — las áreas de Dispositivos con sus cámaras, para filtrar el Historial. */
export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    try { return NextResponse.json(await leerAreasHistorial(), { headers: { "Cache-Control": "no-store" } }); }
    catch (e: any) { return NextResponse.json({ areas: [], asignadas: [], error: e?.message || "No se pudieron leer las áreas." }, { status: 500 }); }
}
