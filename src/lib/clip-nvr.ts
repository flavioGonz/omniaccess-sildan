import { spawn } from "child_process";
import type { NvrConn } from "@/lib/nvr-resolve";
import { configClips, filtroEscala, CRF_POR_CALIDAD, MARCA_AGUA_ANCHO, MARCA_AGUA_MARGEN, type ConfigClip } from "@/lib/clips";

/**
 * Cortar video de la grabación de un NVR: la URL RTSP de playback, el códec del canal y los
 * argumentos de ffmpeg.
 *
 * Vivía adentro de /api/nvr/playback. Salió de ahí para que el clip de una alerta y el que
 * un operador manda por WhatsApp (lib/clip-instante) salgan del MISMO corte que el que se ve
 * y se baja en el panel: antes el worker de despachos tenía su propio ffmpeg, atado a las
 * cámaras de fila de Olivos, y en San Nicolás no producía nada. Es un módulo sólo de
 * servidor (lib/clips lo importa también una pantalla del navegador, y esto lanza procesos).
 */

// El NVR Hikvision (DS-7732NXI de Los Olivos) interpreta starttime/endtime como HORA LOCAL
// del equipo aunque lleven sufijo Z (verificado: ContentMgmt/search devuelve los
// segmentos con hora local "Z"). Formateamos en la zona del NVR (America/Montevideo).
const NVR_TZ = "America/Montevideo";
export function fmtNvr(ms: number): string {
    const d = new Date(ms);
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: NVR_TZ, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(d);
    const g = (t: string) => parts.find((p) => p.type === t)?.value || "00";
    const hh = g("hour") === "24" ? "00" : g("hour");
    return `${g("year")}${g("month")}${g("day")}T${hh}${g("minute")}${g("second")}Z`;
}
export function fmtDahua(ms: number): string {
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
export const DRI = "/dev/dri/renderD128";
let _gpu: boolean | null = null;
export function tieneGpu(): boolean {
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
export async function getCodec(conn: any, ch: string): Promise<string | null> {
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


export type PlanDeCorte = { url: string; canCopy: boolean; DEC: string[]; SWUP: string[]; VF: string; ENC: string[] };

/** URL de playback + cómo procesarla (copy si el canal graba H.264, transcode si HEVC). */
export async function planDeCorte(conn: NvrConn, ch: string, startMs: number, durSeg: number, opciones: { forceTx?: boolean; cfg?: ConfigClip } = {}): Promise<PlanDeCorte> {
    const forceTx = !!opciones.forceTx;
    const port = conn.rtspPort || "554";
    let url: string;
    if (conn.brand === "DAHUA") {
        const s = fmtDahua(startMs), e = fmtDahua(startMs + durSeg * 1000);
        url = `rtsp://${conn.user}:${conn.pass}@${conn.ip}:${port}/cam/playback?channel=${ch}&starttime=${s}&endtime=${e}`;
    } else {
        const start = fmtNvr(startMs);
        const end = fmtNvr(startMs + durSeg * 1000);
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
    const cfg = opciones.cfg || await configClips();
    const alto = cfg.altura || null;
    const DEC = isDahua && hayGpu ? ["-hwaccel", "vaapi", "-hwaccel_device", DRI, "-hwaccel_output_format", "vaapi"] : [];
    const SWUP = hayGpu && !isDahua ? ["-vaapi_device", DRI] : [];
    const VF = !hayGpu ? filtroEscala(cfg.altura) : isDahua ? (alto ? `scale_vaapi=w=-2:h=${alto}` : "scale_vaapi=w=-2:h=-2") : `${alto ? `scale=-2:${alto},` : ""}format=nv12,hwupload`;
    const ENC = hayGpu
        ? ["-c:v", "h264_vaapi", "-qp", String(CRF_POR_CALIDAD[cfg.calidad])]
        : ["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-crf", String(CRF_POR_CALIDAD[cfg.calidad]), "-g", "25", "-threads", "4"];

    return { url, canCopy, DEC, SWUP, VF, ENC };
}

/**
 * Tope de un corte a archivo: el que tenía el modo `whole=1` del playback. Un tramo H.264 en
 * copy sale en segundos; uno HEVC transcodificado por CPU anda a ~1× tiempo real en este CT,
 * así que un clip de 20–30 s entra y uno de minutos no (para eso está el streaming).
 */
export const CORTE_TOPE_MS = 45_000;

/**
 * Escribe a `destino` un MP4 completo (faststart) del tramo pedido. Es el modo `whole=1` del
 * playback: el que reproduce el WebView de Android y el que acepta WhatsApp. Devuelve si
 * quedó un archivo; no inventa nada si el NVR no tiene ese tramo.
 */
export async function cortarDesdeNvr(conn: NvrConn, ch: string, startMs: number, durSeg: number, destino: string, opciones: { forceTx?: boolean; cfg?: ConfigClip; topeMs?: number; marcaAgua?: string | null } = {}): Promise<boolean> {
    const { url, canCopy, DEC, SWUP, VF, ENC } = await planDeCorte(conn, ch, startMs, durSeg, opciones);
    const cfg = opciones.cfg || await configClips();
    // Altura "tal cual graba el NVR" (0) no se conoce sin sondear: se asume 1080, la de estos equipos.
    const altoSalida = cfg.altura || 1080;
    const anchoSalida = Math.round(altoSalida * 16 / 9);
    const logoAncho = Math.round(anchoSalida * MARCA_AGUA_ANCHO / 2) * 2;
    const logoMargen = Math.round(anchoSalida * MARCA_AGUA_MARGEN);
    // Con logo: siempre por software (copy no puede dibujar nada encima, y VAAPI no compone un
    // PNG con transparencia). En San Nicolás ya se recodificaba (los NVR graban HEVC), así que
    // no agrega espera; donde se copiaba, cuesta un transcode de un clip corto.
    const args = opciones.marcaAgua
        ? ["-allowed_media_types", "video", "-rtsp_transport", "tcp", "-i", url, "-i", opciones.marcaAgua, "-t", String(durSeg),
           "-filter_complex",
           // El logo se dimensiona en píxeles a partir de la altura de salida (16:9 de las cámaras):
           // con scale2ref las variables main_w/iw quedaban al revés en este ffmpeg y el logo salía
           // a un 8 % y aplastado (visto el 7/10 en el primer clip enviado).
           `[1:v]scale=${logoAncho}:-1[m];` +
           `[0:v]scale=-2:${altoSalida},format=yuv420p[v];` +
           `[v][m]overlay=x=W-w-${logoMargen}:y=H-h-${logoMargen},format=yuv420p`,
           "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", String(CRF_POR_CALIDAD[cfg.calidad]), "-threads", "4",
           "-movflags", "+faststart", "-y", destino]
        : canCopy
        ? ["-allowed_media_types", "video", "-rtsp_transport", "tcp", "-i", url, "-t", String(durSeg),
           "-an", "-c:v", "copy", "-movflags", "+faststart", "-y", destino]
        : [...DEC, "-allowed_media_types", "video", "-rtsp_transport", "tcp", "-i", url, "-t", String(durSeg),
           "-an", ...SWUP, "-vf", VF, ...ENC, "-movflags", "+faststart", "-y", destino];
    return new Promise<boolean>((resolve) => {
        const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "ignore"] });
        const killer = setTimeout(() => { try { ff.kill("SIGKILL"); } catch { } resolve(false); }, opciones.topeMs ?? CORTE_TOPE_MS);
        ff.on("close", (code) => { clearTimeout(killer); resolve(code === 0); });
        ff.on("error", () => { clearTimeout(killer); resolve(false); });
    });
}
