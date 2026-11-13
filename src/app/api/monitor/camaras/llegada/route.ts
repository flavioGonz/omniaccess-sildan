export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { autorizarMonitor, SIN_CACHE } from "@/lib/monitor/servidor";
import { buscarLlegadaEnRegistro } from "@/lib/vision-llegada-servidor";
import { grabacionDesde } from "@/lib/vision-llegada";

/**
 * GET /api/monitor/camaras/llegada?stream=<stream>&caja=x1,y1,x2,y2[&reloj=<ms>]
 *   → { ms, como, entra?, abrir }
 *
 * Cuándo llegó a su lugar el vehículo que se tocó en el vivo («Ver cuándo llegó»). `caja` es su
 * caja en el cuadro (fracciones); `reloj`, la hora que muestra el vivo, que se usa sólo si el
 * registro todavía no tiene nada de él. `abrir` es desde dónde conviene abrir la grabación.
 * Las reglas y el porqué: lib/vision-llegada. Sólo lectura; se pide al elegir la opción.
 */

/** Igual que en la ruta de siluetas: el stream del vivo lleva el id de la cámara detrás de un prefijo. */
const camaraDeStream = (stream: string) => stream.replace(/^(lpr|face)_/, "").replace(/_hd$/, "");

export async function GET(req: NextRequest) {
    const p = await autorizarMonitor("/api/monitor/camaras/llegada");
    if (p.error) return p.error;
    const sp = req.nextUrl.searchParams;
    const stream = sp.get("stream") || "";
    const caja = (sp.get("caja") || "").split(",").map(Number);
    const reloj = Number(sp.get("reloj"));
    if (!stream || caja.length !== 4 || caja.some((v) => !Number.isFinite(v) || v < 0 || v > 1) || caja[2] <= caja[0] || caja[3] <= caja[1]) {
        return NextResponse.json({ error: "Faltan el stream o la caja del vehículo." }, { status: 400, headers: SIN_CACHE });
    }
    try {
        const r = await buscarLlegadaEnRegistro(camaraDeStream(stream), caja, { reloj: Number.isFinite(reloj) && reloj > 0 ? reloj : null });
        return NextResponse.json({ ms: r.ms, como: r.como, entra: r.entra ?? null, abrir: grabacionDesde(r) }, { headers: SIN_CACHE });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "No se pudo buscar en el registro" }, { status: 500, headers: SIN_CACHE });
    }
}
