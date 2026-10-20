import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import sharp from "sharp";
import { enMontevideo } from "@/lib/filas/horario";

/**
 * La marca de OmniAccess en lo que sale por Telegram y WhatsApp (HB, 20/10, Nico: «a los videos
 * enviados quiero agregarles un splashscreen con datos del video, además logo de OmniAccess,
 * estilizado, animado y profesional; en la foto que enviás, resaltar editada la foto con la cantidad
 * detectada de personas»).
 *
 *   · presentación animada de PRESENTACION_SEG: el isotipo se dibuja (los anillos y el paso), entra
 *     la marca, y después los datos del momento — fila, estado, personas contra límite, espera,
 *     fecha y hora — en escalera; cruza con fundido al video;
 *   · durante el video, una franja inferior con la fila y el momento, y el logo chico en la esquina;
 *   · la foto: las personas que vio la cámara dibujadas, y una franja con la cuenta.
 *
 * Los cuadros se dibujan como SVG con sharp (que no lee variables CSS: los colores van escritos,
 * son los del isotipo, public/omniaccess-mark.svg) y los junta ffmpeg. La tipografía es Outfit
 * (assets/fonts, OFL), instalada en el sistema para que la encuentre librsvg.
 */

export type DatosMarca = {
    fila: string;
    /** «Fila sobre el límite», «Pedido desde Telegram»… */
    titulo: string;
    personas: number | null;
    limite: number;
    esperaMin?: number | null;
    momento: Date;
    tono?: "bien" | "aviso" | "mal";
};

/* Tamaño y tiempo de la presentación. 854×480 = el alto de los clips de alerta (clip-instante). */
const ANCHO = 854, ALTO = 480, FPS = 25;
export const PRESENTACION_SEG = 3.2;
/** Fundido entre la presentación y el video. */
const FUNDIDO_SEG = 0.5;
/** Tope para armar el video marcado: si no sale en este tiempo, se manda el clip tal cual. */
const TOPE_FFMPEG_MS = 60_000;

/* Paleta: la del isotipo y la superficie oscura del panel. */
const C = {
    fondo1: "#070b14", fondo2: "#0f1a2e", tinta: "#f8fafc", tenue: "#94a3b8", linea: "#1e293b",
    acc1: "#0ea5e9", acc2: "#3b82f6", acc3: "#22d3ee",
    bien: "#10b981", aviso: "#f59e0b", mal: "#ef4444",
};
const FUENTE = "Outfit, 'DejaVu Sans', sans-serif";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const lim = (x: number) => Math.max(0, Math.min(1, x));
/** Curva de salida suave (easeOutCubic). */
const suave = (x: number) => 1 - Math.pow(1 - lim(x), 3);
/** Avance de una animación que va de `a` a `b` segundos. */
const tramo = (t: number, a: number, b: number) => suave((t - a) / (b - a));

function tonoDe(d: DatosMarca): "bien" | "aviso" | "mal" {
    if (d.tono) return d.tono;
    if (d.personas == null) return "aviso";
    return d.personas >= d.limite ? "mal" : d.personas >= d.limite * 0.7 ? "aviso" : "bien";
}
const ROTULO = { bien: "Fluida", aviso: "Cargada", mal: "Sobre el límite" } as const;
const fechaHora = (d: Date) => {
    const m = enMontevideo(d);
    const [a, mm, dd] = m.fecha.split("-");
    const s = String(new Date(d.getTime() - 3 * 3600_000).getUTCSeconds()).padStart(2, "0");
    return { fecha: `${dd}/${mm}/${a}`, hora: `${m.hhmm}:${s}` };
};

/** El isotipo (public/omniaccess-mark.svg), dibujándose según `p` (0..1). */
function isotipo(x: number, y: number, escala: number, p: number) {
    const a = tramo(p, 0, 0.55), b = tramo(p, 0.2, 0.75), c = tramo(p, 0.5, 1);
    return `<g transform="translate(${x},${y}) scale(${escala})">
  <path d="M51.7 16.6 A25 25 0 1 0 51.7 47.4" fill="none" stroke="url(#oaG)" stroke-width="5.4" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="${1 - a}"/>
  <path d="M41 21.3 A14 14 0 1 0 41 42.7" fill="none" stroke="url(#oaG)" stroke-width="4.4" stroke-linecap="round" opacity=".78" pathLength="1" stroke-dasharray="1" stroke-dashoffset="${1 - b}"/>
  <path d="M41.5 24 L49.8 32 L41.5 40" fill="none" stroke="url(#oaG)" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round" opacity="${c}" transform="translate(${(1 - c) * -8},0)"/>
  <path d="M53.4 27.2 L58.2 32 L53.4 36.8" fill="none" stroke="url(#oaG)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity="${c * 0.5}" transform="translate(${(1 - c) * -12},0)"/>
</g>`;
}

const DEFS = `<defs>
  <linearGradient id="oaG" x1="6" y1="58" x2="58" y2="6" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.acc1}"/><stop offset=".55" stop-color="${C.acc2}"/><stop offset="1" stop-color="${C.acc3}"/></linearGradient>
  <linearGradient id="fondo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.fondo2}"/><stop offset="1" stop-color="${C.fondo1}"/></linearGradient>
  <linearGradient id="barra" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.acc1}"/><stop offset="1" stop-color="${C.acc3}"/></linearGradient>
  <radialGradient id="brillo"><stop offset="0" stop-color="${C.acc2}" stop-opacity=".35"/><stop offset="1" stop-color="${C.acc2}" stop-opacity="0"/></radialGradient>
</defs>`;

/** Un cuadro de la presentación en el segundo `t`. */
function cuadro(d: DatosMarca, t: number): string {
    const tono = tonoDe(d), col = C[tono];
    const { fecha, hora } = fechaHora(d.momento);
    // El brillo de fondo se desplaza despacio: la presentación no se ve como una imagen quieta.
    const bx = 250 + t * 40, by = 220 - t * 12;
    const marca = tramo(t, 0.55, 1.2), lineaP = tramo(t, 1.0, 1.6);
    const fila = (i: number) => tramo(t, 1.25 + i * 0.16, 1.75 + i * 0.16);
    const y0 = 150;
    const filaTxt = (i: number, y: number, contenido: string) => {
        const p = fila(i);
        return `<g opacity="${p}" transform="translate(${(1 - p) * 18},0)">${contenido.replace(/__Y__/g, String(y))}</g>`;
    };
    const personas = d.personas == null ? "—" : String(d.personas);
    const espera = d.esperaMin === 0 ? "Sin espera" : d.esperaMin != null ? `Espera estimada ~${d.esperaMin} min` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${ANCHO}" height="${ALTO}" viewBox="0 0 ${ANCHO} ${ALTO}">${DEFS}
<rect width="${ANCHO}" height="${ALTO}" fill="url(#fondo)"/>
<circle cx="${bx}" cy="${by}" r="320" fill="url(#brillo)"/>
<g opacity=".06" stroke="${C.tinta}">${Array.from({ length: 12 }, (_, i) => `<line x1="${i * 80 - (t * 10) % 80}" y1="0" x2="${i * 80 - (t * 10) % 80 + 200}" y2="${ALTO}"/>`).join("")}</g>
${isotipo(70, 150, 2.6, tramo(t, 0, 1.1))}
<g opacity="${marca}" transform="translate(${(1 - marca) * -14},0)">
  <text x="70" y="352" font-family="${FUENTE}" font-size="38" font-weight="700" fill="${C.tinta}" letter-spacing="-0.5">OmniAccess</text>
  <text x="72" y="380" font-family="${FUENTE}" font-size="15" font-weight="600" fill="${C.acc3}" letter-spacing="3">CONTROL DE FILAS</text>
</g>
<rect x="352" y="${y0 - 40}" width="2" height="${260 * lineaP}" fill="${C.linea}"/>
${filaTxt(0, y0, `<text x="388" y="__Y__" font-family="${FUENTE}" font-size="14" font-weight="600" fill="${C.tenue}" letter-spacing="2">${esc(d.titulo.toUpperCase())}</text>`)}
${filaTxt(1, y0 + 44, `<text x="388" y="__Y__" font-family="${FUENTE}" font-size="36" font-weight="700" fill="${C.tinta}" letter-spacing="-0.5">${esc(d.fila)}</text>`)}
${filaTxt(2, y0 + 84, `<rect x="388" y="${y0 + 64}" rx="13" width="${ROTULO[tono].length * 7.6 + 28}" height="26" fill="${col}" fill-opacity=".18" stroke="${col}" stroke-opacity=".6"/><text x="402" y="__Y__" font-family="${FUENTE}" font-size="14" font-weight="700" fill="${col}">${ROTULO[tono]}</text>`)}
${filaTxt(3, y0 + 140, `<text x="388" y="__Y__" font-family="${FUENTE}" font-size="44" font-weight="700" fill="${col}">${personas}</text><text x="${388 + personas.length * 25 + 10}" y="__Y__" font-family="${FUENTE}" font-size="18" font-weight="600" fill="${C.tenue}">personas · límite ${d.limite}</text>`)}
${espera ? filaTxt(4, y0 + 176, `<text x="388" y="__Y__" font-family="${FUENTE}" font-size="17" font-weight="600" fill="${C.tinta}">${esc(espera)}</text>`) : ""}
${filaTxt(5, y0 + 214, `<text x="388" y="__Y__" font-family="${FUENTE}" font-size="16" font-weight="600" fill="${C.tenue}">${fecha}  ·  ${hora}</text>`)}
<rect x="0" y="${ALTO - 4}" width="${ANCHO * lim(t / PRESENTACION_SEG)}" height="4" fill="url(#barra)"/>
</svg>`;
}

/** La franja de abajo durante el video, y el logo en la esquina (PNG con transparencia). */
function franja(d: DatosMarca): string {
    const tono = tonoDe(d), col = C[tono];
    const { fecha, hora } = fechaHora(d.momento);
    const txt = `${esc(d.fila)}  ·  ${d.personas ?? "—"} personas  ·  ${fecha} ${hora}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${ANCHO}" height="${ALTO}" viewBox="0 0 ${ANCHO} ${ALTO}">${DEFS}
<linearGradient id="sombra" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".75"/></linearGradient>
<rect x="0" y="${ALTO - 70}" width="${ANCHO}" height="70" fill="url(#sombra)"/>
<rect x="18" y="${ALTO - 40}" width="4" height="22" rx="2" fill="${col}"/>
<text x="32" y="${ALTO - 23}" font-family="${FUENTE}" font-size="16" font-weight="700" fill="${C.tinta}">${txt}</text>
<g opacity=".92">${isotipo(ANCHO - 152, 12, 0.5, 1)}<text x="${ANCHO - 116}" y="35" font-family="${FUENTE}" font-size="15" font-weight="700" fill="${C.tinta}">OmniAccess</text></g>
</svg>`;
}

function ffmpeg(args: string[], topeMs = TOPE_FFMPEG_MS): Promise<boolean> {
    return new Promise((resolve) => {
        const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
        let err = "";
        ff.stderr.on("data", (c) => { err = (err + c).slice(-2000); });
        const k = setTimeout(() => { try { ff.kill("SIGKILL"); } catch { } resolve(false); }, topeMs);
        ff.on("close", (code) => { clearTimeout(k); if (code !== 0) console.error(`[marca-video] ffmpeg ${code}: ${err.slice(-400)}`); resolve(code === 0); });
        ff.on("error", () => { clearTimeout(k); resolve(false); });
    });
}

/**
 * El clip con la presentación adelante, la franja y el logo. Devuelve la ruta del nuevo archivo
 * (al lado del original) o null si no salió: en ese caso se manda el clip tal cual.
 */
export async function videoConMarca(clip: string, d: DatosMarca): Promise<string | null> {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omni-marca-"));
    try {
        const n = Math.round(PRESENTACION_SEG * FPS);
        await Promise.all(Array.from({ length: n }, (_, i) =>
            sharp(Buffer.from(cuadro(d, i / FPS))).png().toFile(path.join(tmp, `c${String(i).padStart(3, "0")}.png`))));
        await sharp(Buffer.from(franja(d))).png().toFile(path.join(tmp, "franja.png"));
        const salida = clip.replace(/\.mp4$/i, "") + "_omni.mp4";
        const ok = await ffmpeg([
            "-y", "-loglevel", "error",
            "-framerate", String(FPS), "-i", path.join(tmp, "c%03d.png"),
            "-i", clip,
            "-loop", "1", "-i", path.join(tmp, "franja.png"),
            "-filter_complex",
            `[0:v]format=yuv420p,setsar=1[intro];` +
            `[1:v]scale=${ANCHO}:${ALTO}:force_original_aspect_ratio=decrease,pad=${ANCHO}:${ALTO}:(ow-iw)/2:(oh-ih)/2,fps=${FPS},setsar=1[c];` +
            `[c][2:v]overlay=0:0:shortest=1,format=yuv420p[cm];` +
            `[intro][cm]xfade=transition=fade:duration=${FUNDIDO_SEG}:offset=${(PRESENTACION_SEG - FUNDIDO_SEG).toFixed(2)},format=yuv420p[v]`,
            "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-movflags", "+faststart", salida,
        ]);
        return ok && fs.existsSync(salida) && fs.statSync(salida).size > 1500 ? salida : null;
    } catch (e: any) {
        console.error(`[marca-video] ${e?.message || e}`);
        return null;
    } finally {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
    }
}

/* ── La foto ──────────────────────────────────────────────────────────────── */

export type PersonaFoto = { caja: [number, number, number, number]; poligono?: [number, number][] | null; p: number };

/**
 * La foto editada para mandar: las personas que vio la cámara dibujadas, con su número, y una
 * franja arriba con la marca y la cuenta («Caja 1 · 12 personas detectadas · límite 10 · 14:35»).
 * Sale a 1280 de ancho, JPEG 84: en el teléfono se ve nítida sin pesar.
 */
export async function fotoConMarca(foto: Buffer, personas: PersonaFoto[], d: DatosMarca): Promise<Buffer> {
    const base = sharp(foto).rotate().resize({ width: 1280, withoutEnlargement: true });
    const { data, info } = await base.toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    const px = (x: number) => ((x + 1) / 2) * W, py = (y: number) => ((1 - y) / 2) * H;
    const tono = tonoDe(d), col = C[tono];
    const grosor = Math.max(2.5, W / 450);
    const formas = personas.map((o, i) => {
        const pts = (o.poligono && o.poligono.length >= 3 ? o.poligono : [[o.caja[0], o.caja[1]], [o.caja[2], o.caja[1]], [o.caja[2], o.caja[3]], [o.caja[0], o.caja[3]]] as [number, number][])
            .map(([x, y]) => `${px(x).toFixed(0)},${py(y).toFixed(0)}`).join(" ");
        const ex = px(o.caja[0]), ey = py(o.caja[1]);
        return `<polygon points="${pts}" fill="${C.acc2}" fill-opacity=".14" stroke="${C.acc3}" stroke-width="${grosor}" stroke-linejoin="round"/>
<circle cx="${ex + 14}" cy="${Math.max(16, ey - 14)}" r="14" fill="${C.acc2}" stroke="${C.tinta}" stroke-width="2"/>
<text x="${ex + 14}" y="${Math.max(16, ey - 14) + 5}" text-anchor="middle" font-family="${FUENTE}" font-size="15" font-weight="700" fill="${C.tinta}">${i + 1}</text>`;
    }).join("");
    const { fecha, hora } = fechaHora(d.momento);
    const alto = Math.round(H * 0.11);
    // Grande, la cuenta de la cámara (lo que dice el aforo); chico, cuántas quedaron marcadas en esta foto.
    const total = d.personas ?? personas.length;
    const sub = `límite ${d.limite} · ${personas.length} ${personas.length === 1 ? "marcada" : "marcadas"} en la foto`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${DEFS}
${formas}
<rect x="0" y="0" width="${W}" height="${alto}" fill="${C.fondo1}" fill-opacity=".82"/>
<rect x="0" y="${alto - 3}" width="${W}" height="3" fill="url(#barra)"/>
${isotipo(14, (alto - 44) / 2, 44 / 64, 1)}
<text x="68" y="${alto * 0.46}" font-family="${FUENTE}" font-size="${Math.round(alto * 0.3)}" font-weight="700" fill="${C.tinta}">${esc(d.fila)}</text>
<text x="68" y="${alto * 0.8}" font-family="${FUENTE}" font-size="${Math.round(alto * 0.2)}" font-weight="600" fill="${C.tenue}">${fecha} · ${hora} · OmniAccess</text>
<g transform="translate(${W - 20},0)">
  <text x="0" y="${alto * 0.5}" text-anchor="end" font-family="${FUENTE}" font-size="${Math.round(alto * 0.36)}" font-weight="700" fill="${col}">${total} ${total === 1 ? "persona" : "personas"}</text>
  <text x="0" y="${alto * 0.82}" text-anchor="end" font-family="${FUENTE}" font-size="${Math.round(alto * 0.2)}" font-weight="600" fill="${C.tinta}">${sub}</text>
</g>
</svg>`;
    return sharp(data).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 84 }).toBuffer();
}
