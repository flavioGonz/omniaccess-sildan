import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { leerAjuste } from "@/lib/ajustes-db";
import { saludVision } from "@/lib/vision";

export const dynamic = "force-dynamic";

/** Cuántas detecciones por página. La grilla muestra unas 30 por pantalla. */
const POR_PAGINA = 60;
/** Rangos que ofrece la pantalla, en horas. Cualquier otro valor cae en el de 24 h. */
const RANGOS_H = new Set([1, 6, 24, 72, 168]);

/**
 * GET /api/vision/detecciones?h=24&camara=&grupo=&clase=&antes=<iso>
 *
 * Lo que guardó el registro de detecciones (vision-worker), más lo que hace falta para la
 * pantalla: el estado del proceso, las cámaras y cuáles se registran, y los conteos del rango
 * por clase y por cámara (sobre el rango entero, no sobre la página).
 *
 * Paginación por `antes` (la primeraVez de la última fila recibida) y no por número de página:
 * mientras se mira llegan detecciones nuevas, y con páginas numeradas se repetirían filas.
 */
export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("El registro de detecciones no es una vista de pantalla.");
    const q = req.nextUrl.searchParams;
    const h = RANGOS_H.has(Number(q.get("h"))) ? Number(q.get("h")) : 24;
    const desde = new Date(Date.now() - h * 3600_000);
    const camara = q.get("camara") || undefined;
    const grupo = q.get("grupo") || undefined;
    const clase = q.get("clase") || undefined;
    const antes = q.get("antes") ? new Date(q.get("antes")!) : undefined;

    const base = { primeraVez: { gte: desde }, ...(camara ? { deviceId: camara } : {}) };
    const filtro = { ...base, ...(grupo ? { grupo } : {}), ...(clase ? { clase } : {}) };

    const [filas, porClase, porCamara, estadoCrudo, camarasCrudo, camaras, vision] = await Promise.all([
        prisma.objetoVisto.findMany({
            where: { ...filtro, ...(antes && !isNaN(antes.getTime()) ? { primeraVez: { gte: desde, lt: antes } } : {}) },
            orderBy: { primeraVez: "desc" }, take: POR_PAGINA,
        }),
        prisma.objetoVisto.groupBy({ by: ["clase", "grupo"], where: base, _count: { _all: true } }),
        prisma.objetoVisto.groupBy({ by: ["deviceId"], where: { primeraVez: { gte: desde } }, _count: { _all: true } }),
        leerAjuste("VISION_REGISTRO_ESTADO"),
        leerAjuste("VISION_CAMARAS"),
        prisma.device.findMany({ where: { deviceType: { not: "NVR" as any } }, select: { id: true, name: true, deviceType: true }, orderBy: { name: "asc" } }),
        saludVision(),
    ]);
    let estado: any = null;
    try { estado = estadoCrudo?.value ? JSON.parse(estadoCrudo.value) : null; } catch { }
    let elegidas: string[] = [];
    try { elegidas = JSON.parse(camarasCrudo?.value || "[]"); } catch { }
    return NextResponse.json({
        filas, h, porPagina: POR_PAGINA,
        porClase: porClase.map((x) => ({ clase: x.clase, grupo: x.grupo, n: x._count._all })).sort((a, b) => b.n - a.n),
        porCamara: Object.fromEntries(porCamara.map((x) => [x.deviceId || "", x._count._all])),
        // "Todas" se guarda como lista vacía: así una cámara nueva entra sola.
        camaras: camaras.map((c) => ({ ...c, registra: !elegidas.length || elegidas.includes(c.id) })),
        estado,
        vision: { ok: !!vision.salud, error: vision.error || null },
    }, { headers: { "Cache-Control": "no-store" } });
}
