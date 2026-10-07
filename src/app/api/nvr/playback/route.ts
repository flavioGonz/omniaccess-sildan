export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { resolveNvrById, getChannelMap } from "@/lib/nvr-resolve";
import { prisma } from "@/lib/prisma";
import { configClips, filtroEscala, CRF_POR_CALIDAD, nombreDeClip } from "@/lib/clips";
import { ventanaPlayback, acotarVentana, ANTES_MAX, DESPUES_MAX } from "@/lib/ventana-playback";

// El NVR Hikvision (DS-7732NXI de Los Olivos) interpreta starttime/endtime como HORA LOCAL
// del equipo aunque lleven sufijo Z (verificado: ContentMgmt/search devuelve los
// segmentos con hora local "Z"). Formateamos en la zona del NVR (America/Montevideo).
const NVR_TZ = "America/Montevideo";
function fmtNvr(ms: number): string {
    const d = new Date(ms);
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: NVR_TZ, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(d);
    const g = (t: string) => parts.find((p) => p.type === t)?.value || "00";
    const hh = g("hour") === "24" ? "00" : g("hour");
    return `${g("year")}${g("month")}${g("day")}T${hh}${g("minute")}${g("second")}Z`;
}
function fmtDahua(ms: number): string {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: NVR_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(ms));
    const g = (t: string) => parts.find((p) => p.type === t)?.value || "00";
    const hh = g("hour") === "24" ? "00" : g("hour");
    return `${g("year")}_${g("month")}_${g("day")}_${hh}_${g("minute")}_${g("second")}`;
}

// ── Códec del canal (cacheado): si el origen ya es H.264, lo pasamos DIRECTO al
// navegador con -c:v copy (remux puro, sin decode/scale/encode) → arranque casi
// instantáneo y CERO carga de GPU. Solo HEVC/H.265 necesita transcode (el navegador
// no lo reproduce en MP4). El códec de un canal es constante, así que cacheamos por
// (ip:ch) por 30 min. (ffprobe verificado: el H.264+/SmartCodec de estos NVR decodifica
// limpio; lo "corrupto" del restream RTSP de la lección de campo era de otra serie.)
const DRI = "/dev/dri/renderD128";
let _gpu: boolean | null = null;
function tieneGpu(): boolean {
    if (_gpu === null) { try { _gpu = require("fs").existsSync(DRI); } catch { _gpu = false; } }
    return _gpu!;
}

type CodecHit = { c: string; ts: number };
const codecCache: Map<string, CodecHit> = (globalThis as any).__nvrCodec ?? new Map<string, CodecHit>();
(globalThis as any).__nvrCodec = codecCache;
const CODEC_TTL = 30 * 60 * 1000;

function isapiCodecHik(conn: any, ch: string): Promise<string | null> {
    // Lee <videoCodecType> del canal por ISAPI (HTTP+Digest) ~200ms. Mucho mas barato
    // que abrir un RTSP de playback solo para sondear el codec.
    return new Promise((resolve) => {
        const p = spawn("curl", [
            "-s", "--digest", "-u", `${conn.user}:${conn.pass}`, "--max-time", "5",
            `http://${conn.ip}/ISAPI/Streaming/channels/${ch}01`,
        ], { stdio: ["ignore", "pipe", "ignore"] });
        let out = "";
        const killer = setTimeout(() => { try { p.kill("SIGKILL"); } catch { } resolve(null); }, 6000);
        p.stdout.on("data", (d: Buffer) => { out += d.toString(); });
        p.on("close", () => { clearTimeout(killer); const m = /<videoCodecType>([^<]+)</i.exec(out); resolve(m ? m[1] : null); });
        p.on("error", () => { clearTimeout(killer); resolve(null); });
    });
}
async function getCodec(conn: any, ch: string): Promise<string | null> {
    const key = `${conn.ip}:${ch}`;
    const hit = codecCache.get(key);
    if (hit && Date.now() - hit.ts < CODEC_TTL) return hit.c;
    let c: string | null = null;
    if (String(conn.brand || "").toUpperCase().includes("DAHUA")) {
        c = "h264"; // los NVR Dahua de este sitio graban H.264
    } else {
        const raw = ((await isapiCodecHik(conn, ch)) || "").toUpperCase();
        c = raw.includes("265") || raw.includes("HEVC") ? "hevc" : raw.includes("264") ? "h264" : null;
    }
    if (c) codecCache.set(key, { c, ts: Date.now() });
    return c;
}

// GET /api/nvr/playback?ch=8&t=<epochMs>&pre=10&dur=40
// Streams recorded video from an NVR (RTSP time-based playback) as fragmented MP4.
export async function GET(req: NextRequest) {
    const sp = req.nextUrl.searchParams;
    const ch = sp.get("ch");
    const t = parseInt(sp.get("t") || "0");
    if (!ch || !/^\d+$/.test(ch) || !t) return new Response("missing ch/t", { status: 400 });
    // Segundos antes/después: lo que diga Ajustes, salvo que la pantalla pida otra cosa a
    // propósito (la miniatura en bucle del monitor de intrusión manda la suya, corta).
    const ventana = await ventanaPlayback();
    const pre = sp.get("pre") != null ? acotarVentana(sp.get("pre"), null).antes : ventana.antes;
    const dur = sp.get("dur") != null
        ? Math.min(ANTES_MAX + DESPUES_MAX, Math.max(5, parseInt(sp.get("dur") || "0") || 5))
        : pre + ventana.despues;

    const conn = await resolveNvrById(sp.get("nvr"));
    if (!conn) return new Response("NVR not configured", { status: 404 });

    const startMs = t - pre * 1000;
    const port = conn.rtspPort || "554";
    let url: string;
    if (conn.brand === "DAHUA") {
        const s = fmtDahua(startMs), e = fmtDahua(startMs + dur * 1000);
        url = `rtsp://${conn.user}:${conn.pass}@${conn.ip}:${port}/cam/playback?channel=${ch}&starttime=${s}&endtime=${e}`;
    } else {
        const start = fmtNvr(startMs);
        const end = fmtNvr(startMs + dur * 1000);
        // `Streaming/tracks/<ch>01?starttime=`, que es la ruta de PLAYBACK de Hikvision. El 6/10
        // a la mañana esto se había cambiado a `Streaming/Channels/<ch>01?starttime=` porque
        // `tracks` contestaba 400: era que el rango no tenía grabación (400 es exactamente lo que
        // el NVR contesta a un rango vacío o futuro). `Channels` "reproducía" porque IGNORA el
        // rango y manda el VIVO: el visor mostraba 11:24 pidiendo las 05:55. Verificado el 6/10
        // con cuadros extraídos de los dos NVR (DS-7616NI-M2/16P V4.63 y DS-7616NXI-K2(D)
        // V4.83): `tracks` cae en el segundo pedido; `Channels` en la hora actual.
        url = `rtsp://${conn.user}:${conn.pass}@${conn.ip}:${port}/Streaming/tracks/${ch}01?starttime=${start}&endtime=${end}`;
    }

    // ¿El origen es H.264? → remux directo (copy). ¿HEVC? → transcode.
    const forceTx = sp.get("tx") === "1";
    const srcCodec = forceTx ? null : await getCodec(conn, ch);
    const canCopy = !forceTx && srcCodec === "h264";

    // Decode por codec (solo ruta transcode): Dahua = H.264 -> GPU (VAAPI);
    // Hik HEVC -> decode por SOFTWARE (el VAAPI de HEVC de estos NVR corrompe: verde/gris).
    const isDahua = String(conn.brand || "").toUpperCase().includes("DAHUA");
    // Sin GPU no hay VAAPI: el contenedor de San Nicolás no tiene /dev/dri, y con los
    // argumentos de VAAPI ffmpeg moría al arrancar → TODO playback HEVC daba 502 (y acá
    // los dos NVR graban todo en H.265). Se decide por lo que hay en el equipo, no por
    // lo que tenía el de Olivos: con GPU, VAAPI; sin GPU, libx264 ultrafast a 720p, que
    // en 8 núcleos rinde un clip a la vez sin despeinarse.
    const hayGpu = tieneGpu();
    // Resolución y calidad: Ajustes → Video del evento (lib/clips). Antes 720p y crf 26 fijos.
    const cfg = await configClips();
    const alto = cfg.altura || null;
    const DEC = isDahua && hayGpu ? ["-hwaccel", "vaapi", "-hwaccel_device", DRI, "-hwaccel_output_format", "vaapi"] : [];
    const SWUP = hayGpu && !isDahua ? ["-vaapi_device", DRI] : [];
    const VF = !hayGpu ? filtroEscala(cfg.altura) : isDahua ? (alto ? `scale_vaapi=w=-2:h=${alto}` : "scale_vaapi=w=-2:h=-2") : `${alto ? `scale=-2:${alto},` : ""}format=nv12,hwupload`;
    const ENC = hayGpu
        ? ["-c:v", "h264_vaapi", "-qp", String(CRF_POR_CALIDAD[cfg.calidad])]
        : ["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-crf", String(CRF_POR_CALIDAD[cfg.calidad]), "-g", "25", "-threads", "4"];

    // Modo "clip completo": genera un MP4 completo (faststart) a un archivo temporal y lo sirve
    // con Content-Length + soporte de rangos. Necesario para que el <video> reproduzca en el
    // WebView de Android (el fMP4 por pipe queda sin reproducir → solo se ve el póster).
    if (sp.get("whole") === "1") {
        const os = await import("os");
        const fs = await import("fs");
        const path = await import("path");
        const tmp = path.join(os.tmpdir(), `clip_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);
        const args = canCopy
            ? ["-allowed_media_types", "video", "-rtsp_transport", "tcp", "-i", url, "-t", String(dur),
               "-an", "-c:v", "copy", "-movflags", "+faststart", "-y", tmp]
            : [...DEC, "-allowed_media_types", "video", "-rtsp_transport", "tcp", "-i", url, "-t", String(dur),
               "-an", ...SWUP, "-vf", VF, ...ENC, "-movflags", "+faststart", "-y", tmp];
        const ok = await new Promise<boolean>((resolve) => {
            const ff2 = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "ignore"] });
            const killer = setTimeout(() => { try { ff2.kill("SIGKILL"); } catch { } resolve(false); }, 45000);
            ff2.on("close", (code) => { clearTimeout(killer); resolve(code === 0); });
            ff2.on("error", () => { clearTimeout(killer); resolve(false); });
        });
        try {
            if (!ok || !fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch { } return new Response("clip no disponible", { status: 502 }); }
            const size = fs.statSync(tmp).size;
            const buf = fs.readFileSync(tmp);
            fs.unlink(tmp, () => { });
            const range = req.headers.get("range");
            if (range) {
                const m = /bytes=(\d+)-(\d*)/.exec(range);
                const s0 = m ? parseInt(m[1]) : 0;
                const e0 = m && m[2] ? parseInt(m[2]) : size - 1;
                const chunk = buf.subarray(s0, e0 + 1);
                return new Response(chunk, { status: 206, headers: { "Content-Type": "video/mp4", "Content-Range": `bytes ${s0}-${e0}/${size}`, "Accept-Ranges": "bytes", "Content-Length": String(chunk.length), "Cache-Control": "no-store" } });
            }
            return new Response(buf, { headers: { "Content-Type": "video/mp4", "Content-Length": String(size), "Accept-Ranges": "bytes", "Cache-Control": "no-store" } });
        } catch {
            try { fs.unlinkSync(tmp); } catch { }
            return new Response("clip error", { status: 502 });
        }
    }

    // Streaming (fragmented MP4 por pipe):
    //  • H.264  → -c:v copy  : SIN transcode. Arranca casi al instante y no toca la GPU.
    //  • HEVC   → transcode a H.264 por VAAPI, escalado a 720p (el navegador no reproduce HEVC en MP4).
    const streamArgs = canCopy
        ? [
            "-allowed_media_types", "video", "-fflags", "nobuffer+genpts", "-flags", "low_delay",
            "-probesize", "500000", "-analyzeduration", "500000",
            "-rtsp_transport", "tcp", "-i", url, "-t", String(dur),
            "-an", "-c:v", "copy",
            "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "200000",
            "-f", "mp4", "pipe:1",
        ]
        : [
            // Sin `nobuffer`/`low_delay` acá: con el decodificador HEVC por software esos dos
            // flags hacen que ffmpeg empiece a sacar cuadros antes de tener la referencia y
            // TODO el clip sale gris (medido el 6/10 sobre NVR 2: 594 B de cuadro contra
            // 11 KB sin los flags). En la rama copy no se decodifica nada y no molestan.
            "-allowed_media_types", "video", "-fflags", "genpts",
            "-probesize", "500000", "-analyzeduration", "500000",
            ...DEC,
            "-rtsp_transport", "tcp", "-i", url, "-t", String(dur),
            "-an", ...SWUP, "-vf", VF, ...ENC,
            "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "200000",
            "-f", "mp4", "pipe:1",
        ];
    const ff = spawn("ffmpeg", streamArgs, { stdio: ["ignore", "pipe", "ignore"] });

    const stream = new ReadableStream({
        start(controller) {
            ff.stdout.on("data", (d: Buffer) => { try { controller.enqueue(d); } catch { } });
            ff.stdout.on("end", () => { try { controller.close(); } catch { } });
            ff.on("error", () => { try { controller.error(new Error("ffmpeg error")); } catch { } });
            ff.on("close", () => { try { controller.close(); } catch { } });
        },
        cancel() { try { ff.kill("SIGKILL"); } catch { } },
    });

    const headers: Record<string, string> = { "Content-Type": "video/mp4", "Cache-Control": "no-store" };
    if (sp.get("download") === "1") {
        // El nombre sale del patrón de Ajustes. La cámara se busca por su canal en el mapa de NVR.
        let camara: string | null = null;
        try {
            const mapa = await getChannelMap();
            const ip = Object.keys(mapa).find((k) => String(mapa[k].ch) === String(ch) && (!sp.get("nvr") || mapa[k].nvrId === sp.get("nvr")));
            if (ip) camara = (await prisma.device.findFirst({ where: { ip }, select: { name: true } }))?.name || null;
        } catch { }
        const fname = `${nombreDeClip(cfg.nombre, { camara, matricula: sp.get("matricula"), fecha: new Date(startMs), canal: ch })}.mp4`;
        headers["Content-Disposition"] = `attachment; filename="${fname}"`;
    }
    return new Response(stream as any, { headers });
}
