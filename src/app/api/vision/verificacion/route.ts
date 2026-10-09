import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { getAnalyticsGeometryBatch } from "@/app/actions/detections";
import { verificacionesDe } from "@/lib/verificacion";
import { leerAjuste } from "@/lib/ajustes-db";

export const dynamic = "force-dynamic";

/**
 * GET /api/vision/verificacion?h=24|168|720 — cómo le va a la doble verificación de intrusión.
 *
 * Por cámara, la matriz que dice si sirve: lo que dijo omni-vision (confirmada, hay alguien,
 * animal, nada) contra lo que decidió el guardia (real, falsa, sin decidir). Lo que importa:
 * de las falsas, cuántas omni-vision NO vio a nadie (esas son las que la verificación ahorraría),
 * y de las reales, cuántas sí vio (si se le escapa una real, la opción de retener avisos no sirve
 * en esa cámara). Más los avisos que se retuvieron de verdad.
 */
const RANGOS_H = new Set([24, 168, 720]);
const TIPOS = ["LINECROSS", "INTRUSION", "REGION_ENTER"];
const VEREDICTOS = ["CONFIRMADA", "PRESENTE", "ANIMAL", "NADA", "SIN"] as const;
const OPERADOR = ["real", "falsa", "pendiente"] as const;

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("No es una vista de pantalla.");
    const hq = Number(req.nextUrl.searchParams.get("h"));
    const h = RANGOS_H.has(hq) ? hq : 168;
    const desde = new Date(Date.now() - h * 3600_000);
    const dets = await prisma.detection.findMany({
        where: { timestamp: { gte: desde }, type: { in: TIPOS } },
        select: { id: true, deviceId: true, acknowledged: true, ackKind: true, verifAt: true, verifAviso: true },
    });
    const ids = [...new Set(dets.map((d) => d.deviceId).filter(Boolean))] as string[];
    const [geom, devs, analiticas] = await Promise.all([
        getAnalyticsGeometryBatch(ids).catch(() => ({})),
        prisma.device.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
        leerAjuste("VISION_ANALITICAS"),
    ]);
    const v = await verificacionesDe(dets.filter((d) => d.verifAt).map((d) => d.id), geom as any);
    const nombre = new Map(devs.map((d) => [d.id, d.name]));
    const vacia = () => Object.fromEntries(VEREDICTOS.map((x) => [x, Object.fromEntries(OPERADOR.map((o) => [o, 0]))])) as Record<string, Record<string, number>>;
    const porCamara = new Map<string, { id: string; nombre: string; total: number; matriz: Record<string, Record<string, number>>; retenidos: number; enviados: number; sinVeredicto: number; conLinea: boolean }>();
    for (const d of dets) {
        const k = d.deviceId || "";
        const c = porCamara.get(k) || { id: k, nombre: nombre.get(k) || "Sin cámara", total: 0, matriz: vacia(), retenidos: 0, enviados: 0, sinVeredicto: 0, conLinea: !!((geom as any)[k]?.line?.length || (geom as any)[k]?.field?.length) };
        const ver = v.get(d.id)?.veredicto || "SIN";
        const op = !d.acknowledged ? "pendiente" : d.ackKind === "false" ? "falsa" : "real";
        c.total++; c.matriz[ver][op]++;
        if (d.verifAviso === "RETENIDO") c.retenidos++; else if (d.verifAviso === "ENVIADO") c.enviados++; else if (d.verifAviso === "SIN_VEREDICTO") c.sinVeredicto++;
        porCamara.set(k, c);
    }
    let activa = true;
    try { activa = (JSON.parse(analiticas?.value || "{}") || {})["verif-intrusion"] !== false; } catch { }
    return NextResponse.json({ h, activa, camaras: [...porCamara.values()].sort((a, b) => b.total - a.total) }, { headers: { "Cache-Control": "no-store" } });
}
