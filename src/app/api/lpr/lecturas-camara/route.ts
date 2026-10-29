import { NextRequest, NextResponse } from "next/server";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { compararLecturas } from "@/lib/lecturas-camara";

export const dynamic = "force-dynamic";

/**
 * GET /api/lpr/lecturas-camara?camara=<id>&h=6 — la pantalla de Lecturas de cámara. El apareo vive
 * en lib/lecturas-camara.ts (lo comparte el informe en PDF y Excel). Pedido de Nico (16/10):
 * validar las detecciones comparándolas con el log de la cámara.
 */
const RANGOS_H = new Set([1, 6, 24, 72, 168]);
/** Filas que se mandan a la pantalla: las más nuevas. El resumen cuenta todas. */
const FILAS_MAX = 3000;

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("No es una vista de pantalla.");
    const sp = req.nextUrl.searchParams;
    const h = RANGOS_H.has(Number(sp.get("h"))) ? Number(sp.get("h")) : 6;
    const camara = sp.get("camara") || "";
    const r = await compararLecturas({ desde: new Date(Date.now() - h * 3600_000), camaras: camara ? [camara] : undefined });
    return NextResponse.json({ h, ...r, filas: r.filas.slice(0, FILAS_MAX) }, { headers: { "Cache-Control": "no-store" } });
}
