export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { resolveNvrById, getChannelMap } from "@/lib/nvr-resolve";
import { prisma } from "@/lib/prisma";
import { configClips, nombreDeClip } from "@/lib/clips";
import { planDeCorte, cortarDesdeNvr } from "@/lib/clip-nvr";
import { ventanaPlayback, acotarVentana, ANTES_MAX, DESPUES_MAX } from "@/lib/ventana-playback";

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
    // Cómo se corta (URL, copy o transcode, resolución y calidad de Ajustes): lib/clip-nvr,
    // compartido con el clip de las alertas y el envío por WhatsApp.
    const forceTx = sp.get("tx") === "1";
    const cfg = await configClips();
    const { url, canCopy, DEC, SWUP, VF, ENC } = await planDeCorte(conn, ch, startMs, dur, { forceTx, cfg });

    // Modo "clip completo": genera un MP4 completo (faststart) a un archivo temporal y lo sirve
    // con Content-Length + soporte de rangos. Necesario para que el <video> reproduzca en el
    // WebView de Android (el fMP4 por pipe queda sin reproducir → solo se ve el póster).
    if (sp.get("whole") === "1") {
        const os = await import("os");
        const fs = await import("fs");
        const path = await import("path");
        const tmp = path.join(os.tmpdir(), `clip_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);
        const ok = await cortarDesdeNvr(conn, ch, startMs, dur, tmp, { forceTx, cfg });
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
