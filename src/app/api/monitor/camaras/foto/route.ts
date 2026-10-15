export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor } from "@/lib/monitor/servidor";
import { authenticatedRequest } from "@/lib/digest-auth";

/**
 * GET /api/monitor/camaras/foto?nvr=<id>&ch=<n>[&w=640] → la foto de un canal de NVR que no es
 * equipo. /api/snapshot/<id> sólo sabe de equipos, y la pared de video muestra todos los
 * canales: en un navegador que no reproduce H.265, la mayoría de las baldosas son esta foto.
 *
 * Misma política que /api/snapshot: la foto recién sacada se comparte durante FOTO_VIGENTE_MS
 * y un pedido en curso no se duplica, así varias pantallas no multiplican los pedidos al NVR.
 */

const GO2RTC = process.env.GO2RTC_API || "http://127.0.0.1:1984";
const FOTO_VIGENTE_MS = 3000;
/** Anchos que se aceptan (los de las baldosas). Cualquier otro valor se ignora. */
const ANCHOS = new Set([320, 480, 640, 960]);
const fotos = new Map<string, { buf: Buffer; t: number }>();
const enCurso = new Map<string, Promise<Buffer | null>>();

/** Último recurso: un cuadro del stream de go2rtc (decodifica H.265 en el servidor, una vez). */
async function cuadroGo2rtc(stream: string): Promise<Buffer | null> {
    try {
        const c = new AbortController(); const t = setTimeout(() => c.abort(), 8000);
        const r = await fetch(`${GO2RTC}/api/frame.jpeg?src=${encodeURIComponent(stream)}`, { cache: "no-store", signal: c.signal });
        clearTimeout(t);
        if (!r.ok) return null;
        const b = Buffer.from(await r.arrayBuffer());
        return b.length > 1000 ? b : null;
    } catch { return null; }
}

export async function GET(req: NextRequest) {
    const p = await autorizarMonitor("/api/monitor/camaras/foto");
    if (p.error) return p.error;
    const nvrId = req.nextUrl.searchParams.get("nvr") || "";
    const ch = parseInt(req.nextUrl.searchParams.get("ch") || "", 10);
    const w = Number(req.nextUrl.searchParams.get("w") || 0);
    const ancho = ANCHOS.has(w) ? w : undefined;
    if (!/^[\w-]+$/.test(nvrId) || !(ch > 0)) return NextResponse.json({ error: "nvr y ch requeridos" }, { status: 400 });

    const clave = `${nvrId}:${ch}:${ancho || "max"}`;
    const guardada = fotos.get(clave);
    let buf: Buffer | null = guardada && Date.now() - guardada.t < FOTO_VIGENTE_MS ? guardada.buf : null;
    if (!buf) {
        let pedido = enCurso.get(clave);
        if (!pedido) {
            pedido = (async () => {
                const nvr = await prisma.device.findUnique({ where: { id: nvrId }, select: { ip: true, username: true, password: true, authType: true, brand: true, deviceType: true } });
                if (!nvr || String(nvr.deviceType) !== "NVR" || !nvr.ip) return null;
                // Directo al canal pedido. No se usa HikvisionDriver.captureSnapshot: si el canal
                // falla prueba "101", y en un NVR eso es la foto del canal 1 con el nombre de otro.
                const dahua = String(nvr.brand).toUpperCase() === "DAHUA";
                const ruta = dahua ? `/cgi-bin/snapshot.cgi?channel=${ch}`
                    : `/ISAPI/Streaming/channels/${ch}01/picture${ancho ? `?videoResolutionWidth=${ancho}&videoResolutionHeight=${Math.round(ancho * 9 / 16)}` : ""}`;
                let b: Buffer | null = null;
                try {
                    const d = await authenticatedRequest("GET", ruta, { ip: nvr.ip, username: nvr.username || "admin", password: nvr.password || "", authType: dahua ? "DIGEST" : nvr.authType } as any, { accept: "image/jpeg", responseType: "arraybuffer", timeout: 6000 });
                    const x = Buffer.from(d as any); b = x.length > 1000 ? x : null;
                } catch { b = null; }
                if (!b) b = await cuadroGo2rtc(`lpr_nvrch-${nvrId}-${ch}`);
                if (b) fotos.set(clave, { buf: b, t: Date.now() });
                return b;
            })().finally(() => enCurso.delete(clave));
            enCurso.set(clave, pedido);
        }
        buf = await pedido;
    }
    if (!buf) return new NextResponse("Sin foto", { status: 502 });
    return new NextResponse(buf as any, { status: 200, headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
}
