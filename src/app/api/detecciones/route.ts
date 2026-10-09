import { NextRequest, NextResponse } from "next/server";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { getRecentDetections, resumenDetecciones } from "@/app/actions/detections";

export const dynamic = "force-dynamic";

/**
 * GET /api/detecciones?n=60&mov=0 — la lista y los contadores del cajón de Detecciones.
 *
 * Es una ruta y no una acción de servidor a propósito: Next encola las acciones de una
 * misma pantalla de a una, y el monitor LPR tiene varias en vuelo al abrir. Medido el 8/10,
 * el cajón tardaba 10,8 s en mostrar algo detrás de esa cola, con consultas que en la base
 * tardan 30 ms. Una ruta GET no espera a nadie.
 */
export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    const n = Math.max(1, Math.min(150, Number(req.nextUrl.searchParams.get("n")) || 60));
    const mov = req.nextUrl.searchParams.get("mov") === "1";
    const [lista, resumen] = await Promise.all([getRecentDetections(n, mov), resumenDetecciones()]);
    return NextResponse.json({ lista, resumen }, { headers: { "Cache-Control": "no-store" } });
}
