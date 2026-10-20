/**
 * Marca de agua para lo que sale por WhatsApp y Telegram (fotos y videos), en los procesos
 * Node sueltos (server.js / waha-handler, dispatch-worker, telegram-bot).
 *
 * Usa exactamente la misma configuración que los clips del panel (lib/clips.ts):
 *   - archivo  public/marca-agua-sildan.png
 *   - apagado  Setting MARCA_AGUA_WHATSAPP = "false"
 *   - posición Setting MARCA_AGUA_POSICION (sup-izq … inf-der, por defecto inf-der)
 *   - tamaño   18 % del ancho de la imagen, margen 2 %
 * Si algo falla, la foto o el video salen igual, sin marca: nunca se pierde un envío por esto.
 */
const fs = require("fs");
const path = require("path");

const ARCHIVO = path.join(__dirname, "public", "marca-agua-sildan.png");
const POSICIONES = ["sup-izq", "sup-centro", "sup-der", "centro-izq", "centro", "centro-der", "inf-izq", "inf-centro", "inf-der"];
const ANCHO = 0.18;
const MARGEN = 0.02;

let cache = { t: 0, v: null };
/** { archivo, pos } o null si la marca está apagada o falta el archivo. Se relee cada minuto. */
async function marcaConfig(prisma) {
    if (Date.now() - cache.t < 60_000) return cache.v;
    let v = null;
    try {
        const filas = prisma ? await prisma.setting.findMany({ where: { key: { in: ["MARCA_AGUA_WHATSAPP", "MARCA_AGUA_POSICION"] } } }) : [];
        const m = Object.fromEntries(filas.map((f) => [f.key, f.value]));
        if (m.MARCA_AGUA_WHATSAPP !== "false" && fs.existsSync(ARCHIVO)) v = { archivo: ARCHIVO, pos: POSICIONES.includes(m.MARCA_AGUA_POSICION) ? m.MARCA_AGUA_POSICION : "inf-der" };
    } catch { v = null; }
    cache = { t: Date.now(), v };
    return v;
}

function partes(pos) { return pos === "centro" ? ["centro", "centro"] : pos.split("-"); }

/** Pega el logo sobre una foto (JPEG/PNG). Devuelve JPEG; si no hay marca o falla, la foto original. */
async function marcarFoto(buf, prisma, calidad = 84) {
    const c = await marcaConfig(prisma);
    if (!c || !buf) return buf;
    try {
        const sharp = require("sharp");
        const { data: base, info } = await sharp(buf).rotate().jpeg({ quality: 95 }).toBuffer({ resolveWithObject: true });
        const W = info.width, H = info.height;
        const logo = await sharp(c.archivo).resize({ width: Math.max(40, Math.round(W * ANCHO)) }).png().toBuffer({ resolveWithObject: true });
        const lw = logo.info.width, lh = logo.info.height, m = Math.round(W * MARGEN);
        const [v, h] = partes(c.pos);
        const left = h === "izq" ? m : h === "der" ? W - lw - m : Math.round((W - lw) / 2);
        const top = v === "sup" ? m : v === "inf" ? H - lh - m : Math.round((H - lh) / 2);
        return await sharp(base).composite([{ input: logo.data, left: Math.max(0, left), top: Math.max(0, top) }]).jpeg({ quality: calidad }).toBuffer();
    } catch (e) {
        console.error("[marca] foto:", e.message);
        return buf;
    }
}

/**
 * Argumentos de ffmpeg para el video: reemplazan a `-vf <filtro>` y agregan el logo como segunda
 * entrada, escalado al 18 % del ancho del video ya escalado. Van DESPUÉS del `-i` del video.
 *   sin marca → ["-vf", filtro]
 *   con marca → ["-loop", "1", "-i", logo, "-filter_complex", "...", "-map", "[out]"]
 */
function argsVideo(c, filtro) {
    if (!c) return ["-vf", filtro];
    const [v, h] = partes(c.pos);
    const m = `W*${MARGEN}`;
    const x = h === "izq" ? m : h === "der" ? `W-w-${m}` : "(W-w)/2";
    const y = v === "sup" ? m : v === "inf" ? `H-h-${m}` : "(H-h)/2";
    const fc = `[0:v]${filtro}[v];[1:v][v]scale2ref=w=main_w*${ANCHO}:h=ow/dar[m][vv];[vv][m]overlay=x=${x}:y=${y}:shortest=1,format=yuv420p[out]`;
    return ["-loop", "1", "-i", c.archivo, "-filter_complex", fc, "-map", "[out]"];
}

module.exports = { marcaConfig, marcarFoto, argsVideo };
