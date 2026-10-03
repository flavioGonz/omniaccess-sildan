export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { resolveNvrById } from "@/lib/nvr-resolve";

// El NVR Hikvision (DS-7732NXI, Sildan) interpreta starttime/endtime como HORA LOCAL
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
    const pre = Math.min(60, Math.max(0, parseInt(sp.get("pre") || "10")));
    const dur = Math.min(180, Math.max(5, parseInt(sp.get("dur") || "40")));
    if (!ch || !/^\d+$/.test(ch) || !t) return new Response("missing ch/t", { status: 400 });

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
        url = `rtsp://${conn.user}:${conn.pass}@${conn.ip}:${port}/Streaming/tracks/${ch}01/?starttime=${start}&endtime=${end}`;
    }

    // ¿El origen es H.264? → remux directo (copy). ¿HEVC? → transcode.
    const srcCodec = await getCodec(conn, ch);
    const canCopy = srcCodec === "h264";

    // Decode por codec (solo ruta transcode): Dahua = H.264 -> GPU (VAAPI);
    // Hik HEVC -> decode por SOFTWARE (el VAAPI de HEVC de estos NVR corrompe: verde/gris).
    const isDahua = String(conn.brand || "").toUpperCase().includes("DAHUA");
    const DEC = isDahua ? ["-hwaccel", "vaapi", "-hwaccel_device", "/dev/dri/renderD128", "-hwaccel_output_format", "vaapi"] : [];
    const SWUP = isDahua ? [] : ["-vaapi_device", "/dev/dri/renderD128"];
    const VF = isDahua ? "scale_vaapi=w=-2:h=720" : "scale=-2:720,format=nv12,hwupload";

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
               "-an", ...SWUP, "-vf", VF, "-c:v", "h264_vaapi", "-qp", "23", "-movflags", "+faststart", "-y", tmp];
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
            "-allowed_media_types", "video", "-fflags", "nobuffer+genpts", "-flags", "low_delay",
            "-probesize", "500000", "-analyzeduration", "500000",
            ...DEC,
            "-rtsp_transport", "tcp", "-i", url, "-t", String(dur),
            "-an", ...SWUP, "-vf", VF, "-c:v", "h264_vaapi", "-qp", "24",
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
        const d = new Date(startMs);
        const p = (n: number) => String(n).padStart(2, "0");
        const fname = `clip_ch${ch}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.mp4`;
        headers["Content-Disposition"] = `attachment; filename="${fname}"`;
    }
    return new Response(stream as any, { headers });
}
