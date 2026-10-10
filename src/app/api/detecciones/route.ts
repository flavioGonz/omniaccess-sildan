import { NextRequest, NextResponse } from "next/server";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { getRecentDetections, resumenDetecciones, getAnalyticsGeometryBatch } from "@/app/actions/detections";
import { verificacionesDe } from "@/lib/verificacion";
import { prisma } from "@/lib/prisma";

/** Cuántas se pueden pedir sueltas con `ids` (las que acaba de verificar vision-worker). */
const MAX_IDS = 20;

/** El veredicto de omni-vision de cada detección, con la geometría vigente de su cámara (lib/verificacion). */
async function veredictos(filas: { id: string; deviceId: string | null }[]) {
    const geom = await getAnalyticsGeometryBatch([...new Set(filas.map((f) => f.deviceId).filter(Boolean))] as string[]).catch(() => ({}));
    const v = await verificacionesDe(filas.map((f) => f.id), geom as any).catch(() => new Map());
    return Object.fromEntries(filas.map((f) => [f.id, v.get(f.id)?.veredicto ?? null]));
}

export const dynamic = "force-dynamic";

/**
 * GET /api/detecciones?n=60&mov=0 — la lista (con el veredicto de omni-vision) y los contadores
 * del cajón de Detecciones. ?ids=a,b — sólo el veredicto de esas.
 *
 * Es una ruta y no una acción de servidor a propósito: Next encola las acciones de una
 * misma pantalla de a una, y el monitor LPR tiene varias en vuelo al abrir. Medido el 8/10,
 * el cajón tardaba 10,8 s en mostrar algo detrás de esa cola, con consultas que en la base
 * tardan 30 ms. Una ruta GET no espera a nadie.
 */
export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    // ?ids=a,b → sólo el veredicto de esas (llegó «detection_verified» y la lista ya las tiene).
    const ids = String(req.nextUrl.searchParams.get("ids") || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, MAX_IDS);
    if (ids.length) {
        const filas = await prisma.detection.findMany({ where: { id: { in: ids } }, select: { id: true, deviceId: true } });
        return NextResponse.json({ veredictos: await veredictos(filas) }, { headers: { "Cache-Control": "no-store" } });
    }
    const n = Math.max(1, Math.min(150, Number(req.nextUrl.searchParams.get("n")) || 60));
    const mov = req.nextUrl.searchParams.get("mov") === "1";
    const [lista, resumen] = await Promise.all([getRecentDetections(n, mov), resumenDetecciones()]);
    const v = await veredictos(lista);
    return NextResponse.json({ lista: lista.map((d) => ({ ...d, veredicto: v[d.id] ?? null })), resumen }, { headers: { "Cache-Control": "no-store" } });
}
