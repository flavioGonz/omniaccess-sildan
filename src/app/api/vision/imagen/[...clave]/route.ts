import { NextRequest, NextResponse } from "next/server";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { imagenDeVision } from "@/lib/vision-imagen";

export const dynamic = "force-dynamic";
/**
 * GET /api/vision/imagen/<clave>[?w=320] — un recorte o un cuadro del registro de detecciones, o
 * un recorte de la relectura de NO_LEIDA (vehículo y chapa).
 *
 * Por acá y no por /api/files: /api/files no pide sesión (sirve las capturas de LPR a la
 * consola y a WhatsApp), y estas fotos son de personas caminando por el barrio. Con sesión, y
 * sólo de este bucket: la clave no puede salir de él.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ clave: string[] }> }) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("El registro de detecciones no es una vista de pantalla.");
    const { clave } = await params;
    return imagenDeVision(clave, Number(req.nextUrl.searchParams.get("w")));
}
