import { NextRequest } from "next/server";
import { autorizarMonitor } from "@/lib/monitor/servidor";
import { buscarConFoto } from "@/lib/vision-parecidos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/monitor/camaras/buscar[?objetos=1][&h=24|168|720][&grupo=…][&area=…] con una imagen:
 * buscar parecidos desde la pared de Cámaras (openspec pared-vms). Es la misma búsqueda que
 * /api/vision/buscar, pero bajo /api/monitor para que la pueda pedir un enlace de pantalla:
 * decisión de Nico (23/10), «cualquier pantalla puede buscar». El alcance la deja a Cámaras y a
 * Rotación; LPR o Intrusión no. Sólo lee: no guarda nada.
 */
export async function POST(req: NextRequest) {
    const p = await autorizarMonitor("/api/monitor/camaras/buscar");
    if (p.error) return p.error;
    // Quién buscó, para poder auditarlo: con enlace de pantalla no hay usuario.
    const quien = p.auth.pantalla ? `pantalla ${p.auth.pantalla.enlaceId}` : `usuario ${p.auth.name || p.auth.userId || "?"}`;
    const sp = req.nextUrl.searchParams;
    console.log(`[pared] ${sp.get("objetos") === "1" ? "objetos en la foto" : `buscar parecidos (${sp.get("grupo") || "todo"}, ${sp.get("h") || 168} h)`} · ${quien}`);
    return buscarConFoto(req);
}
