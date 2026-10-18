export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { resolveNvrById, getChannelMap } from "@/lib/nvr-resolve";
import { prisma } from "@/lib/prisma";
import { configClips, nombreDeClip } from "@/lib/clips";
import { planDeCorte, cortarDesdeNvr } from "@/lib/clip-nvr";
import { esSdpCambiado, marcarSdpCambiado } from "@/lib/rtsp-sdp";
import type { NvrConn } from "@/lib/nvr-resolve";
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
    const hevcOk = sp.get("hevc") === "1";

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

    /*
     * Streaming (fMP4 por pipe), esperando el PRIMER dato antes de contestar (18/10). Antes la
     * respuesta salía con el stream abierto y nada adentro: si el NVR contestaba 400 (no hay
     * grabación), o si ffmpeg se quedaba esperando un cuadro que nunca entendía (el canal 7 del
     * NVR 6, que anuncia H.265 y manda H.264), el navegador esperaba sin saber nada y el visor
     * adivinaba «sin grabación» a los 9 s. Ahora, si no hay video, se contesta un error con el
     * MOTIVO, y si el SDP del canal miente se aprende y se pide otra vez por el pasamanos.
     */
    let abierto = await abrirTramo(conn, ch, startMs, dur, { forceTx, cfg, hevcOk });
    if ("motivo" in abierto && abierto.motivo === "sdp-cambiado") {
        marcarSdpCambiado(conn.ip, ch);
        abierto = await abrirTramo(conn, ch, startMs, dur, { forceTx, cfg, hevcOk });
    }
    if ("motivo" in abierto) {
        const status = abierto.motivo === "sin-grabacion" ? 404 : abierto.motivo === "nvr-lento" || abierto.motivo === "nvr-no-responde" ? 504 : 502;
        return Response.json({ motivo: abierto.motivo, detalle: abierto.detalle }, { status, headers: { "X-Motivo": abierto.motivo, "Cache-Control": "no-store" } });
    }
    const stream = abierto.stream;

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

/** Hasta cuándo se espera el primer pedazo de video: un HEVC transcodificado por CPU tarda unos segundos en dar el primero. */
const PRIMER_DATO_MS = 20_000;

type Motivo = "sin-grabacion" | "nvr-credenciales" | "nvr-no-responde" | "nvr-lento" | "sdp-cambiado" | "nvr-error";

/** Qué dijo ffmpeg, en un motivo que el visor sabe explicar. */
function motivoDe(salida: string): Motivo {
    if (esSdpCambiado(salida)) return "sdp-cambiado";
    if (/400 Bad Request|404 Not Found|453 Not Enough Bandwidth|457 Invalid Range/i.test(salida)) return "sin-grabacion";
    if (/401 Unauthorized|403 Forbidden/i.test(salida)) return "nvr-credenciales";
    if (/Connection refused|Connection timed out|No route to host|Network is unreachable|timed out/i.test(salida)) return "nvr-no-responde";
    return "nvr-error";
}

async function abrirTramo(conn: NvrConn, ch: string, startMs: number, dur: number, o: { forceTx: boolean; cfg: Awaited<ReturnType<typeof configClips>>; hevcOk: boolean }):
    Promise<{ stream: ReadableStream<Uint8Array> } | { motivo: Motivo; detalle: string }> {
    const { url, canCopy: copiaH264, codec, DEC, SWUP, VF, ENC, corregido } = await planDeCorte(conn, ch, startMs, dur, { forceTx: o.forceTx, cfg: o.cfg });
    /**
     * `hevc=1`: quien pide reproduce H.265 (lo comprobó con su vivo), así que un canal que graba
     * H.265 se le pasa tal cual en vez de convertirlo. Por qué (15/10, la pared de cámaras): en
     * San Nicolás los dos NVR graban todo en H.265 y el CT no tiene GPU, así que cada playback era
     * un libx264 por CPU — la misma CPU de la lectura de matrículas — y además bajado a 720p. Con
     * esto el NVR entrega y ffmpeg sólo reempaqueta. La etiqueta hvc1 es la que piden Chrome y Safari.
     */
    const copiaHevc = !o.forceTx && o.hevcOk && /^(hevc|h265)$/i.test(codec || "");
    const canCopy = copiaH264 || copiaHevc;
    //  • H.264  → -c:v copy  : SIN transcode. Arranca casi al instante y no toca la GPU.
    //  • HEVC   → transcode a H.264 (el navegador no reproduce HEVC en MP4).
    const streamArgs = canCopy
        ? [
            "-v", "error",
            "-allowed_media_types", "video", "-fflags", "nobuffer+genpts", "-flags", "low_delay",
            "-probesize", "500000", "-analyzeduration", "500000",
            "-rtsp_transport", "tcp", "-i", url, "-t", String(dur),
            "-an", "-c:v", "copy", ...(copiaHevc ? ["-tag:v", "hvc1"] : []),
            "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "200000",
            "-f", "mp4", "pipe:1",
        ]
        : [
            // Sin `nobuffer`/`low_delay` acá: con el decodificador HEVC por software esos dos
            // flags hacen que ffmpeg empiece a sacar cuadros antes de tener la referencia y
            // TODO el clip sale gris (medido el 6/10 sobre NVR 2: 594 B de cuadro contra
            // 11 KB sin los flags). En la rama copy no se decodifica nada y no molestan.
            "-v", "error",
            "-allowed_media_types", "video", "-fflags", "genpts",
            "-probesize", "500000", "-analyzeduration", "500000",
            ...DEC,
            "-rtsp_transport", "tcp", "-i", url, "-t", String(dur),
            "-an", ...SWUP, "-vf", VF, ...ENC,
            "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "200000",
            "-f", "mp4", "pipe:1",
        ];
    const ff = spawn("ffmpeg", streamArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let salida = "";
    let resolver: (r: "dato" | "fin" | "sdp") => void = () => { };
    const primero = new Promise<"dato" | "fin" | "sdp" | "tarde">((res) => { resolver = res; setTimeout(() => res("tarde"), PRIMER_DATO_MS); });
    ff.stderr.on("data", (d: Buffer) => {
        if (salida.length < 8000) salida += d.toString();
        if (!corregido && esSdpCambiado(salida)) resolver("sdp");
    });
    let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
    const pendientes: Buffer[] = [];
    let cerrado = false;
    ff.stdout.on("data", (d: Buffer) => { resolver("dato"); if (ctrl) { try { ctrl.enqueue(d); } catch { } } else pendientes.push(d); });
    const cerrar = () => { cerrado = true; try { ctrl?.close(); } catch { } };
    ff.stdout.on("end", cerrar);
    ff.on("close", () => { resolver("fin"); cerrar(); });
    ff.on("error", () => { resolver("fin"); try { ctrl?.error(new Error("ffmpeg error")); } catch { } });

    const r = await primero;
    if (r !== "dato") {
        try { ff.kill("SIGKILL"); } catch { }
        const limpio = salida.replace(/rtsp:\/\/[^@\s]*@/g, "rtsp://***@").trim().split("\n").slice(-3).join(" · ").slice(0, 300);
        return { motivo: r === "sdp" ? "sdp-cambiado" : r === "tarde" ? "nvr-lento" : motivoDe(salida), detalle: limpio };
    }
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            ctrl = controller;
            for (const b of pendientes.splice(0)) controller.enqueue(b);
            if (cerrado) { try { controller.close(); } catch { } }
        },
        cancel() { try { ff.kill("SIGKILL"); } catch { } },
    });
    return { stream };
}
