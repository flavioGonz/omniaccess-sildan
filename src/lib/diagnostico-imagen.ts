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
 *  · MOVIDA / GIRADA: ver «Cómo se decide que se movió», abajo.
 * Lo habitual se aprende por separado de día (color) y de noche (infrarrojo, sin color), y sólo con
 * cuadros sanos. Hace falta APRENDER_MIN cuadros antes de juzgar nitidez o escena, y que el mismo
 * problema se repita VECES seguidas para alertar (y otras tantas sanas para cerrar).
 *
 * Cómo se decide que se movió (2/11, Nico: «son bastante sensibles, parece que no se mueve y lo
 * marca igual»). El criterio anterior era «los bordes se parecen menos de 0,45 a la referencia», y
 * eso mide APARIENCIA, no encuadre: el sol y las sombras sobre la vegetación (Perimetral 36: 0,16),
 * un auto distinto estacionado (Estacionamiento Frente 1: 0,25) o una referencia de otra hora bajan
 * el parecido sin que la cámara se haya movido. Medido el 2/11 en el lab sobre 21 cámaras: 20 de ~60
 * estaban en «movida» y en TODAS, buscando el mejor calce corriendo una imagen sobre la otra, el
 * mejor calce era sin correr (0,0). Ninguna se había movido.
 *
 * Ahora la pregunta es geométrica: ¿la imagen de ahora calza mejor con la referencia si se la corre?
 *  · Se comparan las ORIENTACIONES de los bordes (no su intensidad), en 128×72: una sombra cambia
 *    cuánto contraste tiene un borde mucho más que hacia dónde apunta. En las mismas 21 cámaras
 *    subió el parecido de las vegetadas (Perimetral 36: 0,23 → 0,54).
 *  · Se busca el corrimiento que mejor calza, hasta ±12 px en x y ±8 en y (≈ ±10 %).
 *  · CORRIDA: el mejor calce está a DESPLAZA_MIN px o más y gana GANANCIA_MIN sobre el calce sin
 *    correr. Con corrimientos simulados del 5 % (cuadro real recortado), 20 de 21 cámaras lo dieron
 *    con ganancia ≥ 0,09; con los cuadros reales, ninguna.
 *  · GIRADA o apuntando a otro lado: no hay corrimiento que calce, pero el parecido sin correr cae a
 *    menos de CAIDA de lo que es normal PARA ESA CÁMARA. Sólo se juzga en cámaras cuyo parecido
 *    habitual es de HABITUAL_MIN o más: en una vegetada que se parece 0,3 a sí misma, una caída no
 *    distingue un giro de una tarde de sol, y es mejor no avisar que avisar en falso.
 * La referencia es una imagen en grises que se va mezclando con los cuadros sanos que calzan sin
 * correr: acompaña la luz del día y las estaciones, y un golpe de la cámara sigue saltando.
 */
const DIR = path.join(process.cwd(), "data", "diagnostico-imagen");
const GO2RTC = process.env.GO2RTC_API || "http://127.0.0.1:1984";

const CADA_MS = 15 * 60_000;
const POR_VUELTA = 4;
const DESVIO_TAPADA = 6;
const NITIDEZ_FRACCION = 0.35;
const APRENDER_MIN = 3;
const VECES = 2;
/** Tamaño de la imagen con la que se busca el corrimiento. */
const RW = 128, RH = 72;
/** Hasta dónde se busca: ±12 px de 128 y ±8 de 72, ≈ ±10 % del cuadro. */
const RANGO_X = 12, RANGO_Y = 8;
/** Un calce a 1 px es ruido de la compresión; desde 2 px (≈ 1,6 % del ancho) es un corrimiento. */
const DESPLAZA_MIN = 2;
/** Lo que tiene que ganar el calce corrido sobre el calce sin correr (medido: real 0,00; 5 % ≥ 0,09). */
const GANANCIA_MIN = 0.08;
/** Por debajo de este parecido habitual no se juzga el giro (ver arriba). */
const HABITUAL_MIN = 0.6;
/** El giro: el parecido sin correr cae a menos de esta fracción del habitual (4° simulados: 0,99 → 0,31-0,48). */
const CAIDA = 0.55;
/** Cuánto pesa cada cuadro sano en la referencia y en el parecido habitual una vez aprendidos. */
const MEZCLA = 0.15;

export type Problema = "tapada" | "borrosa" | "movida";
export type Medida = { media: number; desvio: number; nitidez: number; color: number; momento: "dia" | "noche"; escena: number | null };
/**
 * Lo habitual de una cámara para un momento (día o noche). `ref` es la imagen de referencia en
 * grises (RW×RH) y `habitual` cuánto se parecen a ella sus cuadros sanos. `bordes`/`nb` son del
 * criterio anterior: se ignoran y desaparecen al reaprender.
 */
type Base = { nitidez: number; n: number; ref?: number[]; nr?: number; habitual?: number; bordes?: number[] | null; nb?: number };
/** El calce con la referencia: sin correr (`cero`) y el mejor corriendo (`mejor`, en dx/dy). */
type Calce = { cero: number; mejor: number; dx: number; dy: number };
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

type Gradiente = { gx: Float32Array; gy: Float32Array; m: Float32Array };
function gradiente(g: ArrayLike<number>): Gradiente {
    const gx = new Float32Array(RW * RH), gy = new Float32Array(RW * RH), m = new Float32Array(RW * RH);
    for (let y = 1; y < RH - 1; y++) for (let x = 1; x < RW - 1; x++) {
        const p = (dx: number, dy: number) => g[(y + dy) * RW + x + dx];
        const a = -p(-1, -1) - 2 * p(-1, 0) - p(-1, 1) + p(1, -1) + 2 * p(1, 0) + p(1, 1);
        const b = -p(-1, -1) - 2 * p(0, -1) - p(1, -1) + p(-1, 1) + 2 * p(0, 1) + p(1, 1);
        const i = y * RW + x; gx[i] = a; gy[i] = b; m[i] = Math.hypot(a, b);
    }
    return { gx, gy, m };
}
/**
 * Cuánto coinciden las orientaciones de los bordes de A y de B corrida (dx, dy), en la zona común:
 * coseno del ángulo entre gradientes, al cuadrado con su signo, pesado por el borde más débil de
 * los dos. 1 = mismos bordes en el mismo lugar; ~0 = nada que ver.
 */
function coincidencia(A: Gradiente, B: Gradiente, dx: number, dy: number): number {
    let num = 0, den = 0;
    for (let y = 2; y < RH - 2; y++) {
        const yb = y + dy; if (yb < 2 || yb >= RH - 2) continue;
        for (let x = 2; x < RW - 2; x++) {
            const xb = x + dx; if (xb < 2 || xb >= RW - 2) continue;
            const i = y * RW + x, j = yb * RW + xb, ma = A.m[i], mb = B.m[j];
            if (ma < 1 || mb < 1) continue;
            const c = (A.gx[i] * B.gx[j] + A.gy[i] * B.gy[j]) / (ma * mb);
            const w = Math.min(ma, mb); num += w * c * Math.abs(c); den += w;
        }
    }
    return den ? num / den : 0;
}
export function calce(ref: ArrayLike<number>, ahora: ArrayLike<number>): Calce {
    const A = gradiente(ref), B = gradiente(ahora);
    let mejor = -Infinity, mdx = 0, mdy = 0;
    for (let dy = -RANGO_Y; dy <= RANGO_Y; dy++) for (let dx = -RANGO_X; dx <= RANGO_X; dx++) {
        const v = coincidencia(A, B, dx, dy);
        if (v > mejor) { mejor = v; mdx = dx; mdy = dy; }
    }
    return { cero: coincidencia(A, B, 0, 0), mejor, dx: mdx, dy: mdy };
}

export async function medir(jpeg: Buffer): Promise<{ medida: Omit<Medida, "escena">; gris: number[] }> {
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
    // Un desenfoque mínimo antes de los bordes: que el ruido de la compresión no cuente como borde.
    const gris = Array.from(await sharp(jpeg).resize(RW, RH, { fit: "fill" }).grayscale().blur(0.6).raw().toBuffer());
    return { medida: { media: Math.round(media), desvio: Math.round(desvio * 10) / 10, nitidez: Math.round(nitidez), color: Math.round(color * 10) / 10, momento: color < 4 ? "noche" : "dia" }, gris };
}

/** La referencia está aprendida: tiene imagen y suficientes cuadros. */
const conRef = (b?: Base): b is Base & { ref: number[] } => !!b?.ref && (b.nr || 0) >= APRENDER_MIN;

function juzgar(e: Estado, m: Omit<Medida, "escena">, gris: number[]): { problema: Problema | null; calce: Calce | null; corrida: boolean } {
    const base = e.base[m.momento];
    const c = conRef(base) ? calce(base.ref, gris) : null;
    if (m.desvio < DESVIO_TAPADA) return { problema: "tapada", calce: c, corrida: false };
    if (base && base.n >= APRENDER_MIN && m.nitidez < base.nitidez * NITIDEZ_FRACCION) return { problema: "borrosa", calce: c, corrida: false };
    if (c) {
        const corrida = Math.max(Math.abs(c.dx), Math.abs(c.dy)) >= DESPLAZA_MIN && c.mejor - c.cero >= GANANCIA_MIN;
        const girada = (base!.habitual ?? 0) >= HABITUAL_MIN && c.cero < (base!.habitual as number) * CAIDA;
        if (corrida || girada) return { problema: "movida", calce: c, corrida };
    }
    return { problema: null, calce: c, corrida: false };
}

function aprender(e: Estado, m: Omit<Medida, "escena">, gris: number[], c: Calce | null) {
    const base: Base = e.base[m.momento] || { nitidez: m.nitidez, n: 0 };
    // Nitidez habitual: media móvil (los primeros cuadros pesan más).
    const k = Math.max(0.1, 1 / (base.n + 1));
    base.nitidez = base.n ? base.nitidez * (1 - k) + m.nitidez * k : m.nitidez;
    base.n++;
    // La referencia: se arma con los primeros cuadros y después sólo se mezcla un cuadro que calza
    // SIN CORRER (si el mejor calce está corrido, no es «lo mismo con otra luz»).
    delete base.bordes; delete base.nb;
    const aprendiendo = (base.nr || 0) < APRENDER_MIN;
    if (!base.ref) { base.ref = gris; base.nr = 1; }
    else if (aprendiendo || (c && c.dx === 0 && c.dy === 0)) {
        const kr = aprendiendo ? 1 / ((base.nr || 0) + 1) : MEZCLA;
        base.ref = base.ref.map((v, i) => Math.round(v * (1 - kr) + gris[i] * kr));
        base.nr = (base.nr || 0) + 1;
        if (c && !aprendiendo) base.habitual = base.habitual == null ? c.cero : base.habitual * (1 - MEZCLA) + c.cero * MEZCLA;
    }
    e.base[m.momento] = base;
}

const TEXTO: Record<Problema, string> = {
    tapada: "Imagen tapada o sin imagen: el cuadro casi no tiene variación (lente tapado, cámara negra o cuadro de error).",
    borrosa: "Imagen borrosa o desenfocada: tiene mucha menos nitidez que lo habitual en esta cámara (foco, lente sucio, lluvia o niebla).",
    movida: "Cámara movida o girada: el encuadre no es el habitual.",
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

/** «la imagen se corrió un 6 % hacia la izquierda y arriba»: hacia dónde se fue lo que se ve. */
function corrimiento(c: Calce): string {
    const lados = [c.dx < 0 ? "la izquierda" : c.dx > 0 ? "la derecha" : "", c.dy < 0 ? "arriba" : c.dy > 0 ? "abajo" : ""].filter(Boolean);
    const pct = Math.round(Math.max(Math.abs(c.dx) / RW, Math.abs(c.dy) / RH) * 100);
    return ` La imagen se corrió un ${pct} % hacia ${lados.join(" y ")}.`;
}

/** Diagnostica una cámara ahora (usa y actualiza lo aprendido). */
export async function diagnosticar(d: { id: string; name: string }): Promise<Estado | null> {
    const jpeg = await cuadro(d.id);
    const e = await leer(d.id);
    e.ultima = Date.now();
    if (!jpeg) { await guardar(e); return null; } // sin cuadro: eso lo dice la salud (offline), no la imagen
    const { medida, gris } = await medir(jpeg);
    // Cambio de criterio (2/11): una «movida» abierta con el criterio anterior se cierra sin aviso.
    // Eran falsas (ver arriba) y mandar un «normalizado» por cada una llenaba el grupo de Telegram.
    if (e.problema === "movida" && !e.base[medida.momento]?.ref) {
        await resolveAlert(d.id, d.name, "imagen", { silencioso: true });
        e.problema = null; e.racha = { problema: null, veces: 0 };
    }
    const { problema, calce: c, corrida } = juzgar(e, medida, gris);
    e.medida = { ...medida, escena: c == null ? null : Math.round(c.cero * 100) / 100 };
    if (!problema) {
        aprender(e, medida, gris, c);
        // Sólo un cuadro que calza sin correr (o mientras se aprende) pasa a ser «lo habitual» de la foto.
        if (c == null || (c.dx === 0 && c.dy === 0)) await fs.writeFile(archivoRef(d.id, medida.momento), jpeg).catch(() => null);
    }
    e.racha = e.racha.problema === problema ? { problema, veces: e.racha.veces + 1 } : { problema, veces: 1 };
    if (e.racha.veces >= VECES) {
        const foto = (titulo: string, ok: boolean) => () => comparacion(d.id, medida.momento, jpeg, titulo, ok);
        if (problema && e.problema !== problema) {
            const habitual = e.base[medida.momento]?.habitual;
            const detalle = problema !== "movida" || !c ? ""
                : corrida ? corrimiento(c)
                : ` Se parece un ${Math.max(0, Math.round(c.cero * 100))} % a su encuadre habitual${habitual != null ? `; lo normal en esta cámara es ${Math.round(habitual * 100)} %` : ""}.`;
            await ensureAlert(d.id, d.name, "imagen", "warning", TEXTO[problema] + detalle, { clave: problema, foto: foto(ROTULO[problema], false) });
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
    return { problema: e.problema, medida: e.medida || null, ultima: e.ultima || null, aprendido: !!b && b.n >= APRENDER_MIN && conRef(b) };
}
