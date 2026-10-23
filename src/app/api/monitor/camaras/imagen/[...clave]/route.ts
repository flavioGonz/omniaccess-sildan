import { NextRequest } from "next/server";
import { autorizarMonitor } from "@/lib/monitor/servidor";
import { imagenDeVision } from "@/lib/vision-imagen";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitor/camaras/imagen/<clave>[?w=320]: las fotos de los resultados de «Buscar
 * parecidos» en la pared (openspec pared-vms). /api/vision/imagen no abre a un enlace de pantalla,
 * y meter /api/vision entero en su alcance le daría también reglas y entrenamiento.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ clave: string[] }> }) {
    const p = await autorizarMonitor("/api/monitor/camaras/imagen");
    if (p.error) return p.error;
    const { clave } = await params;
    return imagenDeVision(clave, Number(req.nextUrl.searchParams.get("w")));
}
