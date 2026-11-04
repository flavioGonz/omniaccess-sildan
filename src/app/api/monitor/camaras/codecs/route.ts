export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { autorizarMonitor, SIN_CACHE } from "@/lib/monitor/servidor";

/**
 * GET /api/monitor/camaras/codecs → el códec de origen de cada stream de la pared.
 *
 * Por qué (pedido de Nico): cada baldosa debe decir qué códec trae la cámara (H.265/H.264) y si
 * el render lo hace la GPU del cliente (directo) o la CPU del servidor (convertido). El códec de
 * origen sólo lo sabe go2rtc: lo lee de los `medias` del productor que está corriendo. El modo
 * (GPU/CPU) lo decide cada navegador y ya lo sabe la baldosa; acá va sólo el códec.
 *
 * Una medida compartida por el proceso y cacheada: con varias pantallas abiertas sigue siendo a
 * lo sumo una consulta a go2rtc cada VIGENCIA_MS.
 */
const GO2RTC = process.env.GO2RTC_API || "http://127.0.0.1:1984";
const VIGENCIA_MS = 5000;

let cache: { t: number; r: Record<string, string | null> } | null = null;
let enCurso: Promise<Record<string, string | null>> | null = null;

/** El nombre del códec, normalizado a lo que entiende el guardia. */
function normCodec(media: string): string | null {
    const m = media.toUpperCase();
    if (/H265|HEVC|HVC1|HEV1/.test(m)) return "H.265";
    if (/H264|AVC1|AVC/.test(m)) return "H.264";
    const mm = m.match(/\b(AV1|VP9|VP8|MJPEG|JPEG)\b/);
    return mm ? mm[1] : null;
}

async function leer(): Promise<Record<string, string | null>> {
    const out: Record<string, string | null> = {};
    try {
        const c = new AbortController(); const t = setTimeout(() => c.abort(), 3000);
        const r = await fetch(`${GO2RTC}/api/streams`, { cache: "no-store", signal: c.signal });
        clearTimeout(t);
        if (!r.ok) return out;
        const streams: Record<string, any> = await r.json();
        for (const [id, s] of Object.entries(streams)) {
            const prods: any[] = (s?.producers || []).filter((p: any) => p?.medias?.length);
            if (!prods.length) continue;
            // El códec de ORIGEN está en el productor que no es la conversión (`ffmpeg:`).
            const fuente = prods.find((p) => !String(p.url || "").startsWith("ffmpeg:")) || prods[0];
            const medias: string[] = (fuente?.medias || []).filter((m: any) => /video/i.test(String(m)));
            let codec: string | null = null;
            for (const m of medias) { codec = normCodec(String(m)); if (codec) break; }
            out[id] = codec;
        }
    } catch { /* sin go2rtc, sin códecs: la baldosa anda igual */ }
    return out;
}

export async function GET() {
    const p = await autorizarMonitor("/api/monitor/camaras/codecs");
    if (p.error) return p.error;
    if (cache && Date.now() - cache.t < VIGENCIA_MS) return NextResponse.json(cache.r, { headers: SIN_CACHE });
    if (!enCurso) enCurso = leer().then((r) => { cache = { t: Date.now(), r }; enCurso = null; return r; }).catch((e) => { enCurso = null; throw e; });
    const r = await enCurso;
    return NextResponse.json(r, { headers: SIN_CACHE });
}
