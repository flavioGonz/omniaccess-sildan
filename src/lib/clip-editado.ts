import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import sharp from "sharp";
import { MARCA_AGUA_ANCHO, MARCA_AGUA_MARGEN } from "@/lib/clips";
import { ZONA } from "@/lib/fechas";

/**
 * El clip «editado» con la marca de OmniAccess: una intro con el logo y, si el corte no lo trae,
 * el logo abajo a la derecha. Es lo que sale a mano desde Exportar clip, por WhatsApp o Telegram
 * (20/10, Nico: «poder seleccionar telegram… siempre con nuestro branding de OmniAccess para
 * intros y marcas de agua»).
 *
 * El diseño es el mismo que el del bot de Telegram (telegram-bot.js, placaIntro y aH264): fondo de
 * la marca, logo blanco, una raya del azul de acción y debajo la cámara y la hora. El bot es JS
 * suelto y no puede importar esto; si cambia uno, cambia el otro.
 *
 * Lo que NO lleva intro ni logo, a propósito: la descarga (es evidencia: el cuadro tiene que ser el
 * del grabador, sin nada encima) y el clip de una alerta (sale apurado, y su logo sigue su ajuste).
 * Se gobierna con el mismo interruptor que el logo (Ajustes → Video del evento): apagado, el clip
 * sale como lo cortó el grabador.
 */

export const ARCHIVO_LOGO_BLANCO = "logo-omniaccess-white.png";
/** El fondo de la marca (og-omniaccess.png), el gris de su bajada y el azul de acción. */
const FONDO_MARCA = "#0b1220";
const GRIS_MARCA = "#94a3b8";
const AZUL_MARCA = "#3b82f6";
/** Cuánto dura la intro y sus fundidos: lo bastante para leer cámara y hora, no tanto que aburra. */
export const INTRO_SEG = 1.8;
const FUNDIDO_SEG = 0.35;
const FPS = 25;
/** Lo más alto que sale: se mira en un teléfono, y 1080 pesaría el doble sin verse mejor. */
const ALTURA_MAX = 720;
/** Tope de la pasada de edición. 60 s de 720p en veryfast tardan ~10 s en el CT; si se pasa, va sin editar. */
const EDICION_TOPE_MS = 60_000;

const publico = (f: string) => path.join(/* turbopackIgnore: true */ process.cwd(), "public", f);
const hay = (f: string) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const xml = (t: string) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const par = (n: number) => Math.max(2, Math.round(n / 2) * 2);

function correr(cmd: string, args: string[], ms: number): Promise<string> {
    return new Promise((ok, mal) => execFile(cmd, args, { timeout: ms, maxBuffer: 4 * 1024 * 1024 }, (e, so, se) => (e ? mal(new Error(String(se || e.message).slice(-300))) : ok(String(so)))));
}

/** «lunes 20 de octubre · 13:05:12», en la hora del barrio. */
export function cuandoLargo(d: Date): string {
    const dia = d.toLocaleDateString("es-UY", { timeZone: ZONA, weekday: "long", day: "numeric", month: "long" });
    const h = d.toLocaleTimeString("es-UY", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    return `${dia} · ${h}`;
}

/**
 * La placa de la intro. Se dibuja con sharp (SVG para el texto) y ffmpeg sólo la funde: más simple
 * que drawtext y con la misma letra que el resto de lo que dibuja el sistema.
 */
export async function placaIntro(ancho: number, alto: number, titulo: string, lineas: string[]): Promise<Buffer> {
    const capas: sharp.OverlayOptions[] = [];
    const logo = publico(ARCHIVO_LOGO_BLANCO);
    if (hay(logo)) {
        // El PNG tiene aire alrededor: se recorta antes de escalar, si no el logo queda chico y corrido.
        const l = await sharp(logo).trim().resize({ width: Math.round(ancho * 0.56) }).toBuffer();
        const m = await sharp(l).metadata();
        capas.push({ input: l, left: Math.round((ancho - (m.width || 0)) / 2), top: Math.max(0, Math.round(alto * 0.40 - (m.height || 0) / 2)) });
    }
    const t1 = Math.round(alto * 0.055), t2 = Math.round(alto * 0.04);
    const y0 = Math.round(alto * 0.66);
    const textos = lineas.filter(Boolean).slice(0, 2).map((l, i) =>
        `<text x="50%" y="${Math.round(y0 + t1 * 1.9 + t2 * 1.7 * (i + 1))}" text-anchor="middle" font-family="Outfit, DejaVu Sans, sans-serif" font-size="${t2}" fill="${GRIS_MARCA}" letter-spacing="1">${xml(l)}</text>`).join("");
    capas.push({
        input: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}">` +
            `<rect x="${Math.round(ancho / 2 - ancho * 0.05)}" y="${y0}" width="${Math.round(ancho * 0.1)}" height="${Math.max(2, Math.round(alto * 0.005))}" rx="2" fill="${AZUL_MARCA}"/>` +
            `<text x="50%" y="${Math.round(y0 + t1 * 1.9)}" text-anchor="middle" font-family="Outfit, DejaVu Sans, sans-serif" font-weight="700" font-size="${t1}" fill="#ffffff">${xml(titulo)}</text>` +
            textos + `</svg>`),
    });
    return sharp({ create: { width: ancho, height: alto, channels: 3, background: FONDO_MARCA } }).composite(capas).png().toBuffer();
}

export type ClipEditado = { ok: true; ancho: number; alto: number; segundos: number } | { ok: false; motivo: string };

/** Ancho, alto y duración de un MP4 (ffprobe). */
export async function medidasDe(archivo: string): Promise<{ ancho: number; alto: number; segundos: number }> {
    const s = (await correr("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", archivo], 15_000));
    const j = JSON.parse(s || "{}");
    return { ancho: Number(j?.streams?.[0]?.width) || 0, alto: Number(j?.streams?.[0]?.height) || 0, segundos: Number(j?.format?.duration) || 0 };
}

/**
 * Le pone la intro (y el logo, si `conMarca`) al clip `archivo`, EN EL LUGAR: el nombre y la URL
 * del clip no cambian. Si algo falla, el archivo queda como estaba y se dice por qué — el envío
 * sigue con el clip sin editar, que es mejor que no mandar nada.
 *
 * Recodifica todo el clip (H.264, faststart): la intro no se puede pegar por copia sin que los
 * parámetros del códec coincidan exactos, y el corte del grabador sale en ultrafast (sin CABAC),
 * así que un concat por copia daría un MP4 que algunos teléfonos no reproducen.
 */
export async function editarClip(archivo: string, p: { titulo: string; lineas: string[]; conMarca: boolean }): Promise<ClipEditado> {
    const marca = publico("marca-agua-omniaccess.png");
    if (p.conMarca && !hay(marca)) return { ok: false, motivo: "falta el logo (public/marca-agua-omniaccess.png)" };
    const intro = `${archivo}.intro.png`, salida = `${archivo}.editado.mp4`;
    try {
        const m = await medidasDe(archivo);
        if (!m.ancho || !m.alto) return { ok: false, motivo: "no se pudo leer el clip" };
        // 704×576 (D1) es el substream anamórfico de una cámara 16:9: se lleva a 16:9 para que no
        // se vea aplastado. Lo demás conserva su forma.
        const r = m.ancho / m.alto;
        const alto = par(Math.min(ALTURA_MAX, m.alto));
        const ancho = r > 1.15 && r < 1.45 ? par(alto * 16 / 9) : par(alto * r);
        fs.writeFileSync(intro, await placaIntro(ancho, alto, p.titulo, p.lineas));
        const logoAncho = par(ancho * MARCA_AGUA_ANCHO), margen = Math.round(ancho * MARCA_AGUA_MARGEN);
        const cam = `[1:v]setpts=PTS-STARTPTS,scale=${ancho}:${alto},setsar=1,fps=${FPS},format=yuv420p,fade=t=in:st=0:d=${FUNDIDO_SEG}`;
        const filtro =
            `[0:v]scale=${ancho}:${alto},setsar=1,format=yuv420p,fade=t=in:st=0:d=${FUNDIDO_SEG},fade=t=out:st=${INTRO_SEG - FUNDIDO_SEG}:d=${FUNDIDO_SEG}[intro];` +
            (p.conMarca
                ? `${cam}[cam];[2:v]scale=${logoAncho}:-1[marca];[cam][marca]overlay=x=W-w-${margen}:y=H-h-${margen},format=yuv420p[video];`
                : `${cam}[video];`) +
            `[intro][video]concat=n=2:v=1:a=0[salida]`;
        await correr("ffmpeg", ["-y", "-loglevel", "error",
            "-loop", "1", "-framerate", String(FPS), "-t", String(INTRO_SEG), "-i", intro,
            "-i", archivo, ...(p.conMarca ? ["-i", marca] : []),
            "-filter_complex", filtro, "-map", "[salida]", "-an",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", salida], EDICION_TOPE_MS);
        // Se compara la duración, no el peso: el corte del grabador sale en ultrafast y pesa el
        // doble que el editado, así que «más chico» no dice nada. Más corto, sí: es un corte a medias.
        const e = hay(salida) ? await medidasDe(salida) : null;
        if (!e || e.segundos < m.segundos * 0.9 + INTRO_SEG * 0.5) return { ok: false, motivo: "la edición salió incompleta" };
        fs.renameSync(salida, archivo);
        return { ok: true, ancho, alto, segundos: e.segundos };
    } catch (e: any) {
        return { ok: false, motivo: String(e?.message || e).slice(0, 200) };
    } finally {
        for (const f of [intro, salida]) { try { fs.unlinkSync(f); } catch { } }
    }
}
