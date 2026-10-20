import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { getAnalyticsGeometryBatch } from "@/app/actions/detections";
import { verificacionesDe } from "@/lib/verificacion";
import { leerAjuste } from "@/lib/ajustes-db";

export const dynamic = "force-dynamic";

/**
 * GET /api/vision/verificacion?h=6|24|72|168|720 — cómo le va a la doble verificación de intrusión.
 *
 * Dos cosas, como Relecturas para las chapas (18/10, Nico: «debe ser similar a la sección de
 * doble verificación LPR»):
 *  · `filas`: cada cruce o intrusión, comparado —lo que dijo la cámara («alguien cruzó», persona o
 *    vehículo) contra lo que vio omni-vision en la captura y en el cuadro propio— y lo que decidió
 *    el guardia. Antes sólo había números: para saber POR QUÉ una cámara daba mal había que ir a
 *    buscar las detecciones una por una al monitor.
 *  · `camaras`: por cámara, la matriz que dice si sirve: de las falsas, cuántas omni-vision NO vio a
 *    nadie (lo que la verificación ahorraría) y de las reales, cuántas sí vio (si se le escapa una
 *    real, retener avisos en esa cámara no conviene). Más los avisos retenidos de verdad.
 *
 * Las filas son las FILAS_MAX más nuevas; la matriz cuenta todo el rango.
 */
const RANGOS_H = new Set([6, 24, 72, 168, 720]);
const TIPOS = ["LINECROSS", "INTRUSION", "REGION_ENTER"];
const VEREDICTOS = ["CONFIRMADA", "PRESENTE", "ANIMAL", "NADA", "SIN"] as const;
const OPERADOR = ["real", "falsa", "pendiente"] as const;
/** Cuántas detecciones se mandan como tarjeta. Las siluetas pesan: con 30 días serían miles. */
const FILAS_MAX = 300;

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("No es una vista de pantalla.");
    const hq = Number(req.nextUrl.searchParams.get("h"));
    const h = RANGOS_H.has(hq) ? hq : 24;
    const desde = new Date(Date.now() - h * 3600_000);
    const dets = await prisma.detection.findMany({
        where: { timestamp: { gte: desde }, type: { in: TIPOS } },
        orderBy: { timestamp: "desc" },
        select: { id: true, deviceId: true, type: true, label: true, snapshotPath: true, timestamp: true, acknowledged: true, ackKind: true, ackAt: true, verifAt: true, verifAviso: true, verifEstado: true, verifMs: true, verifError: true },
    });
    const ids = [...new Set(dets.map((d) => d.deviceId).filter(Boolean))] as string[];
    const [geom, devs, analiticas] = await Promise.all([
        getAnalyticsGeometryBatch(ids).catch(() => ({})),
        prisma.device.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
        leerAjuste("VISION_ANALITICAS"),
    ]);
    const v = await verificacionesDe(dets.filter((d) => d.verifAt).map((d) => d.id), geom as any);
    const nombre = new Map(devs.map((d) => [d.id, d.name]));
    const decisionDe = (d: { acknowledged: boolean; ackKind: string | null }) => (!d.acknowledged ? "pendiente" : d.ackKind === "false" ? "falsa" : "real");
    const vacia = () => Object.fromEntries(VEREDICTOS.map((x) => [x, Object.fromEntries(OPERADOR.map((o) => [o, 0]))])) as Record<string, Record<string, number>>;
    const porCamara = new Map<string, { id: string; nombre: string; total: number; matriz: Record<string, Record<string, number>>; retenidos: number; enviados: number; sinVeredicto: number; conLinea: boolean }>();
    for (const d of dets) {
        const k = d.deviceId || "";
        const c = porCamara.get(k) || { id: k, nombre: nombre.get(k) || "Sin cámara", total: 0, matriz: vacia(), retenidos: 0, enviados: 0, sinVeredicto: 0, conLinea: !!((geom as any)[k]?.line?.length || (geom as any)[k]?.field?.length) };
        const ver = v.get(d.id)?.veredicto || "SIN";
        c.total++; c.matriz[ver][decisionDe(d)]++;
        if (d.verifAviso === "RETENIDO") c.retenidos++; else if (d.verifAviso === "ENVIADO") c.enviados++; else if (d.verifAviso === "SIN_VEREDICTO") c.sinVeredicto++;
        porCamara.set(k, c);
    }
    const filas = dets.slice(0, FILAS_MAX).map((d) => {
        const x = v.get(d.id);
        const a = x?.analisis || null;
        return {
            id: d.id, ts: d.timestamp.toISOString(), deviceId: d.deviceId, camara: d.deviceId ? nombre.get(d.deviceId) || null : null,
            tipo: d.type, clase: d.label, foto: d.snapshotPath,
            /** Qué pasó con omni-vision: OK, SIN_FOTO, ERROR, o null (no la miró: apagada, vieja o en cola). */
            estado: d.verifEstado, error: d.verifError, ms: d.verifMs,
            veredicto: x?.veredicto ?? null, fuente: x?.fuente ?? null, tocan: x?.tocan ?? [],
            // La captura con sus objetos; el cuadro propio va aparte, sin la clave de MinIO (la
            // imagen sale por /api/monitor/intrusion/verificacion/<id>).
            analisis: a ? { ancho: a.ancho, alto: a.alto, objetos: a.objetos, tarea: a.tarea } : null,
            propio: a?.propio && x?.propio ? { veredicto: x.propio.veredicto, despuesS: x.propio.despuesS, analisis: { ancho: a.propio.ancho, alto: a.propio.alto, objetos: a.propio.objetos } } : null,
            decision: decisionDe(d), decididaAt: d.ackAt?.toISOString() || null, aviso: d.verifAviso,
        };
    });
    let activa = true;
    try { activa = (JSON.parse(analiticas?.value || "{}") || {})["verif-intrusion"] !== false; } catch { }
    return NextResponse.json({
        h, activa, total: dets.length, filasMax: FILAS_MAX, filas,
        // La geometría de cada cámara tal como la da el equipo (0-100): la tarjeta la normaliza para
        // dibujar la línea y la ficha completa la usa igual que en el monitor.
        geom,
        camaras: [...porCamara.values()].sort((a, b) => b.total - a.total),
    }, { headers: { "Cache-Control": "no-store" } });
}
