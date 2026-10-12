import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { prisma } from "@/lib/prisma";

/**
 * La intro animada de un clip exportado: antes del video, ~4 s de placa con el logo de la
 * empresa en el centro, la descripción que escribió el operador y los datos del registro, y un
 * fundido al video. Todo con ffmpeg (sin dependencias nuevas) y la tipografía del panel (Outfit).
 *
 * Línea de tiempo (s):
 *   0.00  fondo degradado radial, oscuro, con un movimiento lento y viñeta
 *   0.15  el logo aparece (fundido) y crece de 90 % a 100 % hasta 0.9
 *   0.30  arriba a la izquierda «● REGISTRO DE VIDEO» (el punto titila como un REC)
 *   0.75  la línea de acento se abre desde el centro debajo del logo
 *   1.00  la descripción sube y aparece (hasta 3 renglones)
 *   1.40  cámara · fecha y hora · matrícula, en gris
 *   3.40  fundido cruzado al video (0.6 s)
 *
 * Si algo falla, el clip queda como estaba: la intro es un agregado, nunca un motivo para no
 * entregar el video.
 */

export const AJUSTE_INTRO = "CLIP_INTRO";
const DUR = 4.0;
const XFADE = 0.6;
const DIR_FUENTES = path.join(/* turbopackIgnore: true */ process.cwd(), "assets", "fonts");
const FUENTE = (peso: 400 | 600 | 800) => {
    const f = path.join(DIR_FUENTES, `Outfit-${peso}.ttf`);
    return fs.existsSync(f) ? f : "/usr/share/fonts/truetype/dejavu/DejaVuSans" + (peso >= 600 ? "-Bold" : "") + ".ttf";
};
const FUENTE_SIMBOLOS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

export async function introActiva(): Promise<boolean> {
    const v = (await prisma.setting.findUnique({ where: { key: AJUSTE_INTRO } }).catch(() => null))?.value;
    return v !== "false";
}

function correr(cmd: string, args: string[], topeMs: number): Promise<{ ok: boolean; out: string; err: string }> {
    return new Promise((resolve) => {
        const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
        let out = "", err = "";
        p.stdout.on("data", (d) => { out += d; });
        p.stderr.on("data", (d) => { if (err.length < 4000) err += d; });
        const k = setTimeout(() => { try { p.kill("SIGKILL"); } catch { } resolve({ ok: false, out, err: err + " [tope]" }); }, topeMs);
        p.on("close", (c) => { clearTimeout(k); resolve({ ok: c === 0, out, err }); });
        p.on("error", (e) => { clearTimeout(k); resolve({ ok: false, out, err: String(e) }); });
    });
}

async function medidas(clip: string): Promise<{ w: number; h: number } | null> {
    const r = await correr("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", clip], 10_000);
    const m = r.out.trim().match(/^(\d+)x(\d+)/);
    return m ? { w: +m[1], h: +m[2] } : null;
}

/** Corta la descripción en renglones de hasta `max` caracteres (por palabras), como mucho 3. */
export function renglones(texto: string, max = 40): string[] {
    const palabras = String(texto || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    const out: string[] = [];
    let actual = "";
    for (const p of palabras) {
        if ((actual + " " + p).trim().length > max && actual) { out.push(actual); actual = p; }
        else actual = (actual + " " + p).trim();
        if (out.length === 3) break;
    }
    if (actual && out.length < 3) out.push(actual);
    if (out.length === 3 && palabras.join(" ").length > out.join(" ").length) out[2] = out[2].replace(/.{0,1}$/, "…");
    return out;
}

const pad = (n: number) => String(n).padStart(2, "0");
function fechaHora(d: Date): string {
    const f = new Intl.DateTimeFormat("es-UY", { timeZone: "America/Montevideo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(d);
    const g = (t: string) => f.find((x) => x.type === t)?.value || "00";
    return `${g("day")}/${g("month")}/${g("year")}  ${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}:${g("second")}`;
}

export type DatosIntro = { descripcion?: string | null; camara?: string | null; instante: number; matricula?: string | null; logo?: string | null; titulo?: string | null };

/**
 * Le pone la intro al clip, en el mismo archivo. Devuelve si quedó con intro.
 */
export async function ponerIntro(clip: string, d: DatosIntro, crf = 24): Promise<boolean> {
    const m = await medidas(clip);
    if (!m) return false;
    const W = m.w % 2 ? m.w - 1 : m.w, H = m.h % 2 ? m.h - 1 : m.h;
    const k = H / 720;
    const px = (n: number) => Math.max(1, Math.round(n * k));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "intro-"));
    const salida = clip.replace(/\.mp4$/, "") + ".intro.mp4";
    try {
        const lineas = renglones(d.descripcion || "", W / H > 1.5 ? 40 : 26);
        const meta = [d.camara ? `CÁMARA ${String(d.camara).toUpperCase()}` : null, fechaHora(new Date(d.instante)), d.matricula ? String(d.matricula).toUpperCase() : null].filter(Boolean).join("   ·   ");
        lineas.forEach((l, i) => fs.writeFileSync(path.join(tmp, `l${i}.txt`), l));
        fs.writeFileSync(path.join(tmp, "meta.txt"), meta);
        fs.writeFileSync(path.join(tmp, "rotulo.txt"), (d.titulo || "Registro de video").toUpperCase());

        const logo = d.logo && fs.existsSync(d.logo) ? d.logo : null;
        const logoW = Math.round(W * 0.30 / 2) * 2;
        // Bloque vertical: logo arriba del centro, línea, descripción, meta. Sin descripción, el
        // logo baja un poco para que la placa no quede vacía abajo.
        const hayTexto = lineas.length > 0;
        const yLogo = hayTexto ? 0.33 : 0.40;
        const yLinea = hayTexto ? 0.50 : 0.585;
        const fsDesc = px(lineas.length >= 3 ? 34 : 40);
        const yDesc0 = Math.round(H * (yLinea + 0.065));
        const yMeta = yDesc0 + lineas.length * Math.round(fsDesc * 1.25) + px(lineas.length ? 22 : 8);

        const a = (desde: number, dur: number) => `'min(1\\,max(0\\,(t-${desde})/${dur}))'`;
        const filtros: string[] = [];
        // Fondo
        filtros.push(`[0:v]vignette=PI/4.5,format=yuv420p[bg]`);
        let ult = "bg";
        if (logo) {
            filtros.push(`[1:v]format=rgba,scale=w='${logoW}*(0.90+0.10*min(1\\,t/0.9))':h=-1:eval=frame,fade=t=in:st=0.15:d=0.7:alpha=1[lg]`);
            filtros.push(`[${ult}][lg]overlay=x='(W-w)/2':y='H*${yLogo}-h/2':eval=frame:shortest=1[v1]`);
            ult = "v1";
        } else {
            filtros.push(`[${ult}]drawtext=fontfile=${FUENTE(800)}:text='OmniAccess':expansion=none:fontsize=${px(64)}:fontcolor=white:x=(w-text_w)/2:y=h*${yLogo}-text_h/2:alpha=${a(0.15, 0.7)}[v1]`);
            ult = "v1";
        }
        // Línea de acento que se abre desde el centro
        const anchoLinea = Math.round(W * 0.18);
        filtros.push(`color=c=0x38bdf8:s=${anchoLinea}x${px(3)}:d=${DUR}:r=30,format=rgba,scale=w='max(2\\,${anchoLinea}*min(1\\,max(0\\,(t-0.75)/0.45)))':h=${px(3)}:eval=frame[ln]`);
        filtros.push(`[${ult}][ln]overlay=x='(W-w)/2':y=${Math.round(H * yLinea)}:eval=frame:shortest=1[v2]`);
        ult = "v2";
        // Descripción
        lineas.forEach((_, i) => {
            const y = yDesc0 + i * Math.round(fsDesc * 1.25);
            const t0 = (1.0 + i * 0.12).toFixed(2);
            filtros.push(`[${ult}]drawtext=fontfile=${FUENTE(600)}:textfile=${path.join(tmp, `l${i}.txt`)}:expansion=none:fontsize=${fsDesc}:fontcolor=white:x=(w-text_w)/2:y='${y}+${px(14)}*(1-min(1\\,max(0\\,(t-${t0})/0.5)))':alpha=${a(Number(t0), 0.5)}[d${i}]`);
            ult = `d${i}`;
        });
        // Meta
        filtros.push(`[${ult}]drawtext=fontfile=${FUENTE(400)}:textfile=${path.join(tmp, "meta.txt")}:expansion=none:fontsize=${px(20)}:fontcolor=0x94a3b8:x=(w-text_w)/2:y=${yMeta}:alpha=${a(1.4, 0.5)}[v3]`);
        // Rótulo tipo REC
        filtros.push(`[v3]drawtext=fontfile=${FUENTE(600)}:textfile=${path.join(tmp, "rotulo.txt")}:expansion=none:fontsize=${px(16)}:fontcolor=0xffffff@0.78:x=${px(62)}:y=${px(46)}:alpha=${a(0.3, 0.5)},` +
            `drawtext=fontfile=${FUENTE_SIMBOLOS}:text='●':expansion=none:fontsize=${px(18)}:fontcolor=0xef4444:x=${px(38)}:y=${px(44)}:alpha='if(lt(mod(t\\,1)\\,0.6)\\,1\\,0.3)',fps=30,format=yuv420p,settb=AVTB[intro]`);
        // Clip y fundido
        const iClip = logo ? 2 : 1;
        filtros.push(`[${iClip}:v]scale=${W}:${H},setsar=1,fps=30,format=yuv420p,settb=AVTB[cl]`);
        filtros.push(`[intro][cl]xfade=transition=fade:duration=${XFADE}:offset=${(DUR - XFADE).toFixed(2)},format=yuv420p[v]`);

        const args = [
            "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", `gradients=s=${W}x${H}:d=${DUR}:r=30:c0=0x0b1220:c1=0x13233d:c2=0x050814:type=radial:x0=${Math.round(W / 2)}:y0=${Math.round(H * 0.42)}:x1=${W}:y1=${H}:speed=0.008`,
            ...(logo ? ["-loop", "1", "-t", String(DUR), "-i", logo] : []),
            "-i", clip,
            "-filter_complex", filtros.join(";"),
            "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf), "-pix_fmt", "yuv420p", "-threads", "4",
            "-movflags", "+faststart", salida,
        ];
        const r = await correr("ffmpeg", args, 120_000);
        if (!r.ok || !fs.existsSync(salida) || fs.statSync(salida).size < 2000) {
            console.error("[intro-clip] falló:", r.err.slice(0, 800));
            try { fs.unlinkSync(salida); } catch { }
            return false;
        }
        fs.renameSync(salida, clip);
        return true;
    } catch (e) {
        console.error("[intro-clip]", e);
        try { fs.unlinkSync(salida); } catch { }
        return false;
    } finally {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
    }
}
