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
 * Estilo claro. Línea de tiempo (s):
 *   0.00  fondo blanco → gris perla con un tinte del color de acento, que se mueve lento; dos
 *         manchas de luz del color de acento que derivan en direcciones opuestas
 *   0.15  el logo aparece y crece con desaceleración (86 % → 100 %), con sombra suave
 *   0.30  arriba a la izquierda «● REGISTRO DE VIDEO» (el punto titila como un REC)
 *   0.75  la línea de acento se abre desde el centro debajo del logo
 *   1.00  la descripción sube y aparece (hasta 3 renglones)
 *   1.40  cámara · fecha y hora · matrícula, en gris
 *   0→4   barra de progreso del color de acento en el borde de abajo
 *   3.30  pasa al video por blanco (0.7 s)
 *
 * Si algo falla, el clip queda como estaba: la intro es un agregado, nunca un motivo para no
 * entregar el video.
 */

export const AJUSTE_INTRO = "CLIP_INTRO";
export const AJUSTE_INTRO_COLOR = "CLIP_INTRO_COLOR";
export const INTRO_COLOR_DEFECTO = "#0ea5e9";
/** El logo propio de la intro (se sube en Ajustes). Fuera de public: Next no sirve lo que se crea en runtime. */
export const DIR_MARCA = path.join(/* turbopackIgnore: true */ process.cwd(), "assets", "branding");
export const ARCHIVO_LOGO_INTRO = path.join(DIR_MARCA, "intro-logo.png");
export function logoIntro(): string | null { return fs.existsSync(ARCHIVO_LOGO_INTRO) ? ARCHIVO_LOGO_INTRO : null; }
export async function colorIntro(): Promise<string> {
    const v = (await prisma.setting.findUnique({ where: { key: AJUSTE_INTRO_COLOR } }).catch(() => null))?.value || "";
    return /^#[0-9a-fA-F]{6}$/.test(v) ? v : INTRO_COLOR_DEFECTO;
}
const DUR = 4.0;
const XFADE = 0.7;
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

export type DatosIntro = { descripcion?: string | null; camara?: string | null; instante: number; matricula?: string | null; logo?: string | null; titulo?: string | null; color?: string | null };

const hex = (c: string) => c.replace("#", "0x");
/** Mezcla un color con blanco (p = cuánto del color). */
function aclarar(c: string, p: number): string {
    const n = parseInt(c.replace("#", ""), 16);
    const m = (v: number) => Math.round(255 - (255 - v) * p);
    const r = m((n >> 16) & 255), g = m((n >> 8) & 255), b = m(n & 255);
    return "0x" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/**
 * Versión pastel y luminosa del color de acento, para el fondo: mismo tono, saturación alta y
 * luz alta. Así un acento oscuro (azul marino, negro) no ensucia el fondo de gris.
 */
function pastel(c: string, luz = 0.78): string {
    const n = parseInt(c.replace("#", ""), 16);
    let r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0; const d = mx - mn;
    if (d) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    else h = 222; // gris/negro: se toma un azul pizarra
    const sat = d ? Math.max(0.7, d / (1 - Math.abs(mx + mn - 1) || 1)) : 0.55;
    const C = (1 - Math.abs(2 * luz - 1)) * sat, X = C * (1 - Math.abs(((h / 60) % 2) - 1)), m = luz - C / 2;
    [r, g, b] = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
    return "#" + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
}

/** Mancha de luz redonda (PNG con alfa) del color dado; se genera una vez y queda en caché. */
async function mancha(color: string): Promise<string | null> {
    const dir = path.join(os.tmpdir(), "omni-intro");
    try { fs.mkdirSync(dir, { recursive: true }); } catch { }
    const fp = path.join(dir, `mancha-${color.replace("#", "")}.png`);
    if (fs.existsSync(fp)) return fp;
    const n = parseInt(color.replace("#", ""), 16);
    const r = await correr("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=800x800",
        "-vf", `format=rgba,geq=r=${(n >> 16) & 255}:g=${(n >> 8) & 255}:b=${n & 255}:a='255*pow(max(0\\,1-hypot(X-400\\,Y-400)/400)\\,1.8)'`, "-frames:v", "1", fp], 20_000);
    return r.ok && fs.existsSync(fp) ? fp : null;
}

/** Trama de puntos (PNG con alfa) para la textura del fondo; en caché por tamaño. */
async function trama(w: number, h: number, paso: number): Promise<string | null> {
    const dir = path.join(os.tmpdir(), "omni-intro");
    try { fs.mkdirSync(dir, { recursive: true }); } catch { }
    const fp = path.join(dir, `trama-${w}x${h}-${paso}.png`);
    if (fs.existsSync(fp)) return fp;
    const r2 = Math.max(1.2, paso / 16).toFixed(2);
    const r = await correr("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=black:s=${w}x${h}`,
        "-vf", `format=rgba,geq=r=71:g=85:b=105:a='if(lt(hypot(mod(X\\,${paso})-${paso / 2}\\,mod(Y\\,${paso})-${paso / 2})\\,${r2})\\,70\\,0)'`, "-frames:v", "1", fp], 30_000);
    return r.ok && fs.existsSync(fp) ? fp : null;
}

/** Banda de brillo (blanca, bordes suaves, inclinada) que cruza la placa una vez. */
async function brillo(h: number): Promise<string | null> {
    const dir = path.join(os.tmpdir(), "omni-intro");
    const fp = path.join(dir, `brillo-${h}.png`);
    if (fs.existsSync(fp)) return fp;
    const bw = Math.round(h * 0.5), bh = Math.round(h * 1.6);
    const r = await correr("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=white:s=${bw}x${bh}`,
        "-vf", `format=rgba,geq=r=255:g=255:b=255:a='255*0.55*exp(-pow((X-${bw / 2})/${(bw / 5).toFixed(1)}\\,2))',rotate=a=0.35:c=none:ow=rotw(0.35):oh=roth(0.35)`, "-frames:v", "1", fp], 30_000);
    return r.ok && fs.existsSync(fp) ? fp : null;
}

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
    const acento = d.color && /^#[0-9a-fA-F]{6}$/.test(d.color) ? d.color : await colorIntro();
    try {
        const lineas = renglones(d.descripcion || "", W / H > 1.5 ? 40 : 26);
        const meta = [d.camara ? `CÁMARA ${String(d.camara).toUpperCase()}` : null, fechaHora(new Date(d.instante)), d.matricula ? String(d.matricula).toUpperCase() : null].filter(Boolean).join("   ·   ");
        lineas.forEach((l, i) => fs.writeFileSync(path.join(tmp, `l${i}.txt`), l));
        fs.writeFileSync(path.join(tmp, "meta.txt"), meta);
        fs.writeFileSync(path.join(tmp, "rotulo.txt"), (d.titulo || "Registro de video").toUpperCase());

        const logo = d.logo && fs.existsSync(d.logo) ? d.logo : null;
        const suave = pastel(acento);
        const blob = await mancha(suave);
        const logoW = Math.round(W * 0.30 / 2) * 2;
        const logoHmax = Math.round(H * 0.24);
        const hayTexto = lineas.length > 0;
        const yLogo = hayTexto ? 0.33 : 0.42;
        const yLinea = hayTexto ? 0.51 : 0.60;
        const fsDesc = px(lineas.length >= 3 ? 34 : 40);
        const yDesc0 = Math.round(H * (yLinea + 0.06));
        const yMeta = yDesc0 + lineas.length * Math.round(fsDesc * 1.25) + px(lineas.length ? 22 : 8);
        const a = (desde: number, dur: number) => `'min(1\\,max(0\\,(t-${desde})/${dur}))'`;

        // Entradas: 0 fondo, manchas, trama, brillo, logo y el clip al final.
        const paso = Math.max(18, Math.round(W / 46));
        const [tr, br] = await Promise.all([trama(W + paso * 4, H + paso * 4, paso), brillo(H)]);
        const entradas: string[] = ["-f", "lavfi", "-i",
            `gradients=s=${W}x${H}:d=${DUR}:r=30:nb_colors=4:c0=0xffffff:c1=${aclarar(suave, 0.30)}:c2=0xf8fafc:c3=${aclarar(pastel(acento, 0.86), 0.25)}:type=radial:x0=${Math.round(W * 0.3)}:y0=${Math.round(H * 0.2)}:x1=${W}:y1=${H}:speed=0.03`];
        let i = 1;
        const add = (fp: string | null, loop = true) => { if (!fp) return -1; entradas.push(...(loop ? ["-loop", "1", "-t", String(DUR)] : []), "-i", fp); return i++; };
        const iBlob = add(blob), iTrama = add(tr), iBrillo = add(br), iLogo = add(logo);
        const iClip = i; entradas.push("-i", clip);

        const f: string[] = [];
        f.push(`[0:v]format=rgba[bg0]`);
        let ult = "bg0";
        if (iBlob >= 0) {
            // Aurora: tres manchas del color de acento que derivan lento en direcciones distintas.
            const bw = Math.round(W * 0.8 / 2) * 2;
            f.push(`[${iBlob}:v]scale=${bw}:${bw},format=rgba,colorchannelmixer=aa=0.62,split=3[b1][b2][b3]`);
            f.push(`[${ult}][b1]overlay=x='-W*0.25+${px(55)}*t':y='-H*0.55+${px(18)}*t':eval=frame:shortest=1[bg1]`);
            f.push(`[bg1][b2]overlay=x='W*0.55-${px(45)}*t':y='H*0.30-${px(14)}*t':eval=frame:shortest=1[bg2]`);
            f.push(`[b3]colorchannelmixer=aa=0.45[b3b];[bg2][b3b]overlay=x='W*0.05+${px(30)}*sin(t*0.9)':y='H*0.55':eval=frame:shortest=1[bg3]`);
            ult = "bg3";
        }
        if (iTrama >= 0) {
            // Textura: trama de puntos que se desplaza en diagonal, con un fundido en los bordes.
            f.push(`[${iTrama}:v]format=rgba,colorchannelmixer=aa=0.9[tr]`);
            f.push(`[${ult}][tr]overlay=x='-mod(t*${px(14)}\\,${paso})-${paso}':y='-mod(t*${px(9)}\\,${paso})-${paso}':eval=frame:shortest=1[bg4]`);
            ult = "bg4";
        }
        if (logo) {
            // Logo con sombra suave: una copia negra desenfocada, corrida hacia abajo.
            const p = `min(1\\,max(0\\,(t-0.15)/0.75))`;
            f.push(`[${iLogo}:v]format=rgba,scale=w='min(${logoW}\\,iw*${logoHmax}/ih)':h=-1,split[lgA][lgB]`);
            f.push(`[lgA]scale=w='iw*(0.86+0.14*(1-pow(1-${p}\\,3)))':h=-1:eval=frame,fade=t=in:st=0.15:d=0.6:alpha=1[lg]`);
            const pd = px(48);
            f.push(`[lgB]pad=iw+${pd * 2}:ih+${pd * 2}:${pd}:${pd}:color=black@0,colorchannelmixer=rr=0:gg=0:bb=0:aa=0.30,boxblur=luma_radius=${px(18)}:luma_power=2:chroma_radius=${px(18)}:chroma_power=2:alpha_radius=${px(18)}:alpha_power=3,fade=t=in:st=0.35:d=0.8:alpha=1[sh]`);
            f.push(`[${ult}][sh]overlay=x='(W-w)/2':y='H*${yLogo}-h/2+${px(16)}':shortest=1[s1]`);
            f.push(`[s1][lg]overlay=x='(W-w)/2':y='H*${yLogo}-h/2':eval=frame:shortest=1[v1]`);
        } else {
            f.push(`[${ult}]drawtext=fontfile=${FUENTE(800)}:text='OmniAccess':expansion=none:fontsize=${px(64)}:fontcolor=0x0f172a:x=(w-text_w)/2:y=h*${yLogo}-text_h/2:alpha=${a(0.15, 0.7)}[v1]`);
        }
        ult = "v1";
        if (iBrillo >= 0) {
            // Un brillo cruza la placa una vez, después de que entra el logo.
            f.push(`[${ult}][${iBrillo}:v]overlay=x='-w+(W+w)*min(1\\,max(0\\,(t-1.15)/1.1))':y='(H-h)/2':eval=frame:shortest=1[v1b]`);
            ult = "v1b";
        }
        const anchoLinea = Math.round(W * 0.16);
        f.push(`color=c=${hex(acento)}:s=${anchoLinea}x${px(4)}:d=${DUR}:r=30,format=rgba,scale=w='max(2\\,${anchoLinea}*(1-pow(1-min(1\\,max(0\\,(t-0.75)/0.5))\\,3)))':h=${px(4)}:eval=frame[ln]`);
        f.push(`[${ult}][ln]overlay=x='(W-w)/2':y=${Math.round(H * yLinea)}:eval=frame:shortest=1[v2]`);
        ult = "v2";
        lineas.forEach((_, j) => {
            const y = yDesc0 + j * Math.round(fsDesc * 1.25);
            const t0 = (1.0 + j * 0.12).toFixed(2);
            f.push(`[${ult}]drawtext=fontfile=${FUENTE(600)}:textfile=${path.join(tmp, `l${j}.txt`)}:expansion=none:fontsize=${fsDesc}:fontcolor=0x0f172a:x=(w-text_w)/2:y='${y}+${px(16)}*(1-min(1\\,max(0\\,(t-${t0})/0.55)))':alpha=${a(Number(t0), 0.55)}[d${j}]`);
            ult = `d${j}`;
        });
        f.push(`[${ult}]drawtext=fontfile=${FUENTE(400)}:textfile=${path.join(tmp, "meta.txt")}:expansion=none:fontsize=${px(20)}:fontcolor=0x64748b:x=(w-text_w)/2:y=${yMeta}:alpha=${a(1.4, 0.5)}[v3]`);
        f.push(`[v3]null[v4]`);
        // Barra de progreso abajo
        f.push(`color=c=${hex(acento)}:s=${W}x${px(5)}:d=${DUR}:r=30,format=rgba,scale=w='max(2\\,${W}*t/${DUR})':h=${px(5)}:eval=frame[pb]`);
        f.push(`[v4][pb]overlay=x=0:y=H-h:eval=frame:shortest=1,fps=30,format=yuv420p,settb=AVTB[intro]`);
        f.push(`[${iClip}:v]scale=${W}:${H},setsar=1,fps=30,format=yuv420p,settb=AVTB[cl]`);
        f.push(`[intro][cl]xfade=transition=fadewhite:duration=${XFADE}:offset=${(DUR - XFADE).toFixed(2)},format=yuv420p[v]`);

        const args = ["-hide_banner", "-loglevel", "error", "-y", ...entradas, "-filter_complex", f.join(";"),
            "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf), "-pix_fmt", "yuv420p", "-threads", "4", "-movflags", "+faststart", salida];
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
