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

let cache: { t: number; r: Record<string, any> } | null = null;
let enCurso: Promise<Record<string, any>> | null = null;

/*
 * Señal de origen de cada stream (14/11, NVR Dahua de Nicolás): cuánto llega de verdad desde la
 * cámara, medido entre dos lecturas de go2rtc. Hay cámaras que el NVR dice «conectadas» pero que
 * mandan menos de un cuadro por segundo o nada: la baldosa abría el video, no arrancaba, reintentaba
 * y llenaba la consola de 500. Con esto la baldosa sabe de antemano qué esperar.
 *   sin   → nada en la ventana medida (o el productor no tiene video): foto, sin abrir video
 *   debil → llega, pero muy poco (menos de KBPS_DEBIL): video igual, avisado
 *   ok    → normal
 */
const KBPS_DEBIL = 400;
const VENTANA_MIN_MS = 4000;
let muestra: { t: number; bytes: Record<string, number> } | null = null;
let senalPrev: Record<string, { estado: "ok" | "debil" | "sin"; kbps: number }> = {};

/** El nombre del códec, normalizado a lo que entiende el guardia. */
function normCodec(media: string): string | null {
    const m = media.toUpperCase();
    if (/H265|HEVC|HVC1|HEV1/.test(m)) return "H.265";
    if (/H264|AVC1|AVC/.test(m)) return "H.264";
    const mm = m.match(/\b(AV1|VP9|VP8|MJPEG|JPEG)\b/);
    return mm ? mm[1] : null;
}

async function leer(): Promise<Record<string, any>> {
    const out: Record<string, any> = {};
    const bytesAhora: Record<string, number> = {};
    const sinVideo = new Set<string>();
    try {
        const c = new AbortController(); const t = setTimeout(() => c.abort(), 3000);
        const r = await fetch(`${GO2RTC}/api/streams`, { cache: "no-store", signal: c.signal });
        clearTimeout(t);
        if (!r.ok) return out;
        const streams: Record<string, any> = await r.json();
        for (const [id, s] of Object.entries(streams)) {
            const prods: any[] = (s?.producers || []).filter((p: any) => p?.medias?.length);
            // Precargado (preload) pero sin video: go2rtc lo está reintentando y la cámara no contesta.
            if (!prods.length) { if ((s?.producers || []).some((p: any) => /127\.0\.0\.1:8556/.test(String(p?.url || "")))) sinVideo.add(id); continue; }
            // El códec de ORIGEN está en el productor que no es la conversión (`ffmpeg:`).
            const fuente = prods.find((p) => !String(p.url || "").startsWith("ffmpeg:")) || prods[0];
            const medias: string[] = (fuente?.medias || []).filter((m: any) => /video/i.test(String(m)));
            let codec: string | null = null;
            for (const m of medias) { codec = normCodec(String(m)); if (codec) break; }
            out[id] = codec;
            const rec = (fuente?.receivers || [])[0];
            if (rec && typeof rec.bytes === "number") bytesAhora[id] = rec.bytes;
        }
        const ahora = Date.now();
        if (muestra && ahora - muestra.t >= VENTANA_MIN_MS) {
            const s: typeof senalPrev = {};
            for (const [id, b] of Object.entries(bytesAhora)) {
                const antes = muestra.bytes[id];
                if (antes == null || b < antes) continue;
                const kbps = Math.round(((b - antes) * 8) / (ahora - muestra.t));
                s[id] = { kbps, estado: kbps === 0 ? "sin" : kbps < KBPS_DEBIL ? "debil" : "ok" };
            }
            for (const id of sinVideo) s[id] = { kbps: 0, estado: "sin" };
            senalPrev = s;
            muestra = { t: ahora, bytes: bytesAhora };
        } else if (!muestra) muestra = { t: ahora, bytes: bytesAhora };
        out._senal = senalPrev;
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
