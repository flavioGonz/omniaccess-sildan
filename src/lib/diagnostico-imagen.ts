import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { ensureAlert, resolveAlert } from "@/lib/device-health";
import { hora as horaDe } from "@/lib/fechas";

/**
 * Diagnóstico de imagen de las cámaras (21/10, Nico: «detectar imagen borrosa, tapada, girada o
 * desenfocada, y convertirlo en alerta de salud»).
 *
 * Primero se miró lo de Hikvision: el VQD de los NVR VPro de Otto contesta «notSupport» para los
 * canales IP (es de canales analógicos), y las cámaras traen detecciones propias (sabotaje, cambio
 * de escena; desenfoque sólo las LPR) pero apagadas, y prenderlas es escribir en cada cámara. Así
 * que el diagnóstico es propio, sobre un cuadro de cada cámara, para cualquier marca y sin tocar
 * nada en el equipo (en San Nicolás, además, el lab no puede escribir).
 *
 * Cada cámara se mira cada ~15 min (unas pocas por vuelta de la salud, en ronda). Del cuadro, en
 * chico y en grises, se sacan tres números, cada uno comparado con lo que es NORMAL PARA ESA CÁMARA
 * (no con un valor fijo: una calle de noche y un pasillo de día no se parecen):
 *  · TAPADA / SIN IMAGEN: casi sin variación (desvío < DESVIO_TAPADA): un lente tapado, una
 *    cámara negra o un cuadro gris de error;
 *  · BORROSA / DESENFOCADA: la nitidez (varianza del laplaciano) cae por debajo de NITIDEZ_FRACCION
 *    de la habitual de esa cámara. También la da la lluvia o la niebla: es aviso, no crítica;
 *  · MOVIDA / GIRADA: los bordes del cuadro (Sobel, 64×36) se parecen poco a los de su referencia
 *    (correlación < ESCENA_MIN): la cámara apunta a otro lado.
 * Lo habitual se aprende por separado de día (color) y de noche (infrarrojo, sin color), y sólo con
 * cuadros sanos. Hace falta APRENDER_MIN cuadros antes de juzgar nitidez o escena, y que el mismo
 * problema se repita VECES seguidas para alertar (y otras tantas sanas para cerrar).
 */
const DIR = path.join(process.cwd(), "data", "diagnostico-imagen");
const GO2RTC = process.env.GO2RTC_API || "http://127.0.0.1:1984";

const CADA_MS = 15 * 60_000;
const POR_VUELTA = 4;
const DESVIO_TAPADA = 6;
const NITIDEZ_FRACCION = 0.35;
const ESCENA_MIN = 0.45;
const ESCENA_ACTUALIZA = 0.65;
const APRENDER_MIN = 3;
const VECES = 2;
const BORDES_W = 64, BORDES_H = 36;

export type Problema = "tapada" | "borrosa" | "movida";
export type Medida = { media: number; desvio: number; nitidez: number; color: number; momento: "dia" | "noche"; escena: number | null };
type Base = { nitidez: number; n: number; bordes: number[] | null; nb: number };
type Estado = { id: string; ultima: number; base: { dia?: Base; noche?: Base }; racha: { problema: Problema | null; veces: number }; medida?: Medida; problema: Problema | null };

const archivo = (id: string) => path.join(DIR, `${id.replace(/[^\w-]/g, "_")}.json`);
/**
 * El último cuadro SANO de cada cámara, de día y de noche: es «lo habitual» que se muestra al lado del
 * cuadro de ahora en el aviso de Telegram (29/10, Nico: «debe comparar la imagen»). Se pisa con cada
 * cuadro que coincide con la referencia, así no queda una foto de hace un mes.
 */
const archivoRef = (id: string, momento: "dia" | "noche") => path.join(DIR, `${id.replace(/[^\w-]/g, "_")}-${momento}.jpg`);
async function leer(id: string): Promise<Estado> {
    try { return JSON.parse(await fs.readFile(archivo(id), "utf8")); }
    catch { return { id, ultima: 0, base: {}, racha: { problema: null, veces: 0 }, problema: null }; }
}
async function guardar(e: Estado) { await fs.mkdir(DIR, { recursive: true }); await fs.writeFile(archivo(e.id), JSON.stringify(e)); }

async function cuadro(id: string): Promise<Buffer | null> {
    const r = await fetch(`${GO2RTC}/api/frame.jpeg?src=${encodeURIComponent(`lpr_${id}`)}`, { cache: "no-store", signal: AbortSignal.timeout(12000) }).catch(() => null);
    if (!r?.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    return b.length > 2000 ? b : null;
}

function bordes(g: Uint8Array, w: number, h: number): number[] {
    // Sobel sobre la imagen reducida; vector normalizado (media 0, norma 1) para correlacionar.
    const out = new Array<number>(w * h).fill(0);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const p = (dx: number, dy: number) => g[(y + dy) * w + (x + dx)];
        const gx = -p(-1, -1) - 2 * p(-1, 0) - p(-1, 1) + p(1, -1) + 2 * p(1, 0) + p(1, 1);
        const gy = -p(-1, -1) - 2 * p(0, -1) - p(1, -1) + p(-1, 1) + 2 * p(0, 1) + p(1, 1);
        out[y * w + x] = Math.hypot(gx, gy);
    }
    const m = out.reduce((s, v) => s + v, 0) / out.length;
    const c = out.map((v) => v - m);
    const n = Math.sqrt(c.reduce((s, v) => s + v * v, 0)) || 1;
    return c.map((v) => v / n);
}
export const correlacion = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * (b[i] || 0), 0);

export async function medir(jpeg: Buffer): Promise<{ medida: Omit<Medida, "escena">; bordes: number[] }> {
    // Color: diferencia media entre canales (una cámara en infrarrojo da casi cero).
    const rgb = await sharp(jpeg).resize(160, 90, { fit: "fill" }).removeAlpha().raw().toBuffer();
    let color = 0;
    for (let i = 0; i < rgb.length; i += 3) color += Math.abs(rgb[i] - rgb[i + 1]) + Math.abs(rgb[i + 1] - rgb[i + 2]);
    color /= rgb.length / 3;
    const W = 320, H = 180;
    const g = new Uint8Array(await sharp(jpeg).resize(W, H, { fit: "fill" }).grayscale().raw().toBuffer());
    let s = 0, s2 = 0;
    for (const v of g) { s += v; s2 += v * v; }
    const media = s / g.length, desvio = Math.sqrt(Math.max(0, s2 / g.length - media * media));
    // Nitidez: varianza del laplaciano (4 vecinos).
    let ls = 0, ls2 = 0, n = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W];
        ls += l; ls2 += l * l; n++;
    }
    const nitidez = ls2 / n - (ls / n) ** 2;
    const chico = new Uint8Array(await sharp(jpeg).resize(BORDES_W, BORDES_H, { fit: "fill" }).grayscale().raw().toBuffer());
    return { medida: { media: Math.round(media), desvio: Math.round(desvio * 10) / 10, nitidez: Math.round(nitidez), color: Math.round(color * 10) / 10, momento: color < 4 ? "noche" : "dia" }, bordes: bordes(chico, BORDES_W, BORDES_H) };
}

function juzgar(e: Estado, m: Omit<Medida, "escena">, b: number[]): { problema: Problema | null; escena: number | null } {
    const base = e.base[m.momento];
    const escena = base?.bordes && base.nb >= APRENDER_MIN ? correlacion(b, base.bordes) : null;
    if (m.desvio < DESVIO_TAPADA) return { problema: "tapada", escena };
    if (base && base.n >= APRENDER_MIN && m.nitidez < base.nitidez * NITIDEZ_FRACCION) return { problema: "borrosa", escena };
    if (escena != null && escena < ESCENA_MIN) return { problema: "movida", escena };
    return { problema: null, escena };
}

function aprender(e: Estado, m: Omit<Medida, "escena">, b: number[], escena: number | null) {
    const base: Base = e.base[m.momento] || { nitidez: m.nitidez, n: 0, bordes: null, nb: 0 };
    // Nitidez habitual: media móvil (los primeros cuadros pesan más).
    const k = Math.max(0.1, 1 / (base.n + 1));
    base.nitidez = base.n ? base.nitidez * (1 - k) + m.nitidez * k : m.nitidez;
    base.n++;
    // Referencia de bordes: se arma con los primeros y después sólo se ajusta con cuadros muy parecidos.
    if (!base.bordes) { base.bordes = b; base.nb = 1; }
    else if (base.nb < APRENDER_MIN || (escena != null && escena > ESCENA_ACTUALIZA)) {
        const kb = base.nb < APRENDER_MIN ? 1 / (base.nb + 1) : 0.1;
        const mez = base.bordes.map((v, i) => v * (1 - kb) + b[i] * kb);
        const nn = Math.sqrt(mez.reduce((s, v) => s + v * v, 0)) || 1;
        base.bordes = mez.map((v) => v / nn); base.nb++;
    }
    e.base[m.momento] = base;
}

const TEXTO: Record<Problema, string> = {
    tapada: "Imagen tapada o sin imagen: el cuadro casi no tiene variación (lente tapado, cámara negra o cuadro de error).",
    borrosa: "Imagen borrosa o desenfocada: tiene mucha menos nitidez que lo habitual en esta cámara (foco, lente sucio, lluvia o niebla).",
    movida: "Cámara movida o girada: lo que se ve ya no coincide con su encuadre habitual.",
};

const ROTULO: Record<Problema, string> = { tapada: "Tapada", borrosa: "Borrosa", movida: "Movida" };

/** Para el texto sobre la foto: el SVG no acepta &, < ni > sueltos. */
const xml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * La foto del aviso: el encuadre habitual a la izquierda y el cuadro de ahora a la derecha, cada uno
 * con su rótulo. El de ahora lleva un borde en el color del estado (rojo el problema, verde la vuelta
 * a lo normal) para que se lea sin el texto. Sin referencia guardada todavía, va sólo el de ahora.
 */
export async function comparacion(id: string, momento: "dia" | "noche", ahora: Buffer, estado: string, ok: boolean): Promise<Buffer | null> {
    const W = 640, H = 360, BANDA = 34, BORDE = 6;
    const ref = await fs.readFile(archivoRef(id, momento)).catch(() => null);
    const color = ok ? "#10b981" : "#e11d48";
    const panel = async (img: Buffer, rotulo: string, marcado: boolean) => {
        const foto = await sharp(img).resize(W, H, { fit: "cover" }).jpeg().toBuffer();
        const svg = Buffer.from(`<svg width="${W}" height="${H + BANDA}" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="${BANDA}" fill="#0b1220"/>
            ${marcado ? `<rect x="0" y="0" width="${BORDE}" height="${BANDA}" fill="${color}"/>` : ""}
            <text x="${marcado ? 16 : 12}" y="23" font-family="DejaVu Sans, Arial, sans-serif" font-size="16" font-weight="bold" fill="#ffffff">${xml(rotulo)}</text>
            ${marcado ? `<rect x="${BORDE / 2}" y="${BANDA + BORDE / 2}" width="${W - BORDE}" height="${H - BORDE}" fill="none" stroke="${color}" stroke-width="${BORDE}"/>` : ""}
        </svg>`);
        return sharp({ create: { width: W, height: H + BANDA, channels: 3, background: "#0b1220" } })
            .composite([{ input: foto, top: BANDA, left: 0 }, { input: svg, top: 0, left: 0 }]).png().toBuffer();
    };
    const hora = horaDe(new Date());
    const derecha = await panel(ahora, `Ahora · ${hora} · ${estado}`, true);
    if (!ref) return sharp(derecha).jpeg({ quality: 82 }).toBuffer();
    const izquierda = await panel(ref, "Habitual", false);
    const SEP = 4;
    return sharp({ create: { width: W * 2 + SEP, height: H + BANDA, channels: 3, background: "#0b1220" } })
        .composite([{ input: izquierda, top: 0, left: 0 }, { input: derecha, top: 0, left: W + SEP }]).jpeg({ quality: 82 }).toBuffer();
}

/** Diagnostica una cámara ahora (usa y actualiza lo aprendido). */
export async function diagnosticar(d: { id: string; name: string }): Promise<Estado | null> {
    const jpeg = await cuadro(d.id);
    const e = await leer(d.id);
    e.ultima = Date.now();
    if (!jpeg) { await guardar(e); return null; } // sin cuadro: eso lo dice la salud (offline), no la imagen
    const { medida, bordes } = await medir(jpeg);
    const { problema, escena } = juzgar(e, medida, bordes);
    e.medida = { ...medida, escena: escena == null ? null : Math.round(escena * 100) / 100 };
    if (!problema) {
        aprender(e, medida, bordes, escena);
        // Sólo un cuadro que se parece a la referencia (o mientras se aprende) pasa a ser «lo habitual».
        if (escena == null || escena > ESCENA_ACTUALIZA) await fs.writeFile(archivoRef(d.id, medida.momento), jpeg).catch(() => null);
    }
    e.racha = e.racha.problema === problema ? { problema, veces: e.racha.veces + 1 } : { problema, veces: 1 };
    if (e.racha.veces >= VECES) {
        const foto = (titulo: string, ok: boolean) => () => comparacion(d.id, medida.momento, jpeg, titulo, ok);
        if (problema && e.problema !== problema) {
            const pct = escena == null ? "" : ` Se parece un ${Math.max(0, Math.round(escena * 100))} % a su encuadre habitual.`;
            await ensureAlert(d.id, d.name, "imagen", "warning", TEXTO[problema] + (problema === "movida" ? pct : ""), { clave: problema, foto: foto(ROTULO[problema], false) });
            e.problema = problema;
        }
        if (!problema && e.problema) { await resolveAlert(d.id, d.name, "imagen", { foto: foto("Normal", true) }); e.problema = null; }
    }
    await guardar(e);
    return e;
}

/** Una vuelta: las cámaras que hace más de CADA_MS no se miran, de a POR_VUELTA. La llama la salud. */
export async function vueltaDiagnostico(): Promise<number> {
    const { equiposApagados } = await import("@/lib/apagado");
    const apagados = await equiposApagados();
    const equipos = (await prisma.device.findMany({ where: { deviceType: { in: ["LPR_CAMERA", "LPR_INTERIOR", "CAMERA", "QUEUE_COUNTER"] as any } }, select: { id: true, name: true } }))
        .filter((d) => !apagados.has(d.id));
    const estados = await Promise.all(equipos.map(async (d) => ({ d, ultima: (await leer(d.id)).ultima })));
    const toca = estados.filter((x) => Date.now() - x.ultima > CADA_MS).sort((a, b) => a.ultima - b.ultima).slice(0, POR_VUELTA);
    for (const x of toca) await diagnosticar(x.d).catch((e) => console.error("[diagnostico-imagen]", x.d.name, e?.message));
    return toca.length;
}

export async function estadoImagen(id: string): Promise<{ problema: Problema | null; medida: Medida | null; ultima: number | null; aprendido: boolean }> {
    const e = await leer(id);
    const b = e.medida ? e.base[e.medida.momento] : undefined;
    return { problema: e.problema, medida: e.medida || null, ultima: e.ultima || null, aprendido: !!b && b.n >= APRENDER_MIN && b.nb >= APRENDER_MIN };
}
