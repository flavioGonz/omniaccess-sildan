export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor, SIN_CACHE } from "@/lib/monitor/servidor";
import { resolveNvrById } from "@/lib/nvr-resolve";
import { msDeLocal, tramosHik } from "@/lib/nvr-tramos";

/**
 * GET /api/monitor/camaras/linea?nvr=<id>&ch=<n>&dia=YYYY-MM-DD[&equipo=<id>]
 *   → { tramos: [desdeMs, hastaMs][] | null, eventos: [...] }
 *
 * Lo que dibuja la regla de la grabación sobre el video, para un día:
 *  · tramos: dónde HAY grabación en el NVR (ISAPI ContentMgmt/search). Antes la regla era lisa y
 *    se sabía que no había grabación recién después de esperar 9 s a que el NVR no mandara nada;
 *    ahora el hueco se ve antes de tocarlo. null = no se pudo saber (Dahua, NVR caído): la
 *    pantalla no pinta tramos en vez de pintar «no hay».
 *  · eventos: las detecciones de la cámara, sus lecturas si lee chapas, y lo que registró
 *    OmniVision (personas, vehículos, animales). Son las marcas de la regla —sobre la franja
 *    verde— y lo que recorren las flechas de «evento anterior / siguiente».
 *
 * Sólo lectura. Se pide al abrir la grabación y al cambiar de día, no en bucle.
 */

/** Lo que OmniVision registra y vale la pena marcar en la regla. */
const GRUPOS_VISION = ["persona", "vehiculo", "animal", "propio"];
/** Hasta cuántas marcas por día: más no se distinguen en la regla y sólo pesan. */
const EVENTOS_MAX = 600;
/** La etiqueta con la que server.js deja la detección de un canal que no está en el mapa. */
const etiquetaCanal = (ch: number) => `canal ${ch} sin mapear`;

export async function GET(req: NextRequest) {
    const p = await autorizarMonitor("/api/monitor/camaras/linea");
    if (p.error) return p.error;
    const sp = req.nextUrl.searchParams;
    const nvrId = sp.get("nvr") || "";
    const ch = parseInt(sp.get("ch") || "", 10);
    const dia = sp.get("dia") || "";
    const equipo = sp.get("equipo") || "";
    // El id con el que OmniVision registra esta cámara: el del equipo, o `nvrch-<nvr>-<ch>`.
    const vid = equipo || `nvrch-${nvrId}-${ch}`;
    if (!/^[\w-]{1,80}$/.test(nvrId) || !(ch > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(dia) || (equipo && !/^[\w-]{1,80}$/.test(equipo))) {
        return NextResponse.json({ error: "nvr, ch y dia requeridos" }, { status: 400 });
    }
    const desde = msDeLocal(`${dia}T00:00:00`)!, hasta = msDeLocal(`${dia}T23:59:59`)! + 999;
    const rango = { gte: new Date(desde), lte: new Date(hasta) };

    const conn = await resolveNvrById(nvrId);
    const [tramos, detecciones, lecturas, vistos] = await Promise.all([
        conn && String(conn.brand).toUpperCase() !== "DAHUA" ? tramosHik(conn, ch, dia).catch(() => null) : Promise.resolve(null),
        prisma.detection.findMany({
            where: { timestamp: rango, type: { not: "MOTION" }, OR: [...(equipo ? [{ deviceId: equipo }] : []), { deviceId: nvrId, label: etiquetaCanal(ch) }] },
            select: { id: true, timestamp: true, type: true, label: true }, orderBy: { timestamp: "asc" }, take: EVENTOS_MAX,
        }).catch(() => []),
        equipo ? prisma.accessEvent.findMany({
            where: { deviceId: equipo, timestamp: rango },
            select: { id: true, timestamp: true, plateDetected: true, decision: true, direction: true, details: true }, orderBy: { timestamp: "asc" }, take: EVENTOS_MAX,
        }).catch(() => []) : Promise.resolve([]),
        // Lo que OmniVision registró en esta cámara (vision-worker): una marca por pista, al empezar.
        prisma.objetoVisto.findMany({
            where: { deviceId: vid, primeraVez: rango, grupo: { in: GRUPOS_VISION } },
            select: { id: true, primeraVez: true, ultimaVez: true, grupo: true, clase: true, confianza: true }, orderBy: { primeraVez: "asc" }, take: EVENTOS_MAX,
        }).catch(() => []),
    ]);

    const eventos = [
        ...detecciones.map((d) => ({ id: d.id, ts: d.timestamp.getTime(), clase: "deteccion" as const, tipo: String(d.type), plate: null as string | null, ok: null as boolean | null })),
        ...lecturas.map((l) => ({ id: l.id, ts: l.timestamp.getTime(), clase: "lectura" as const, tipo: String(l.direction), plate: l.plateDetected || null, ok: String(l.decision) === "GRANT" && !/lista negra/i.test(l.details || "") })),
        // `fin`: cuánto estuvo a la vista (la pista de OmniVision), para pintar el tramo en la regla.
        ...vistos.map((o) => ({ id: o.id, ts: o.primeraVez.getTime(), fin: o.ultimaVez.getTime(), clase: "vision" as const, tipo: o.grupo, nombre: o.grupo === "propio" ? o.clase : null, plate: null as string | null, ok: null as boolean | null })),
    ].sort((a, b) => a.ts - b.ts).slice(0, EVENTOS_MAX);

    return NextResponse.json({ dia, desde, hasta, tramos, eventos, marca: conn ? String(conn.brand) : null }, { headers: SIN_CACHE });
}

