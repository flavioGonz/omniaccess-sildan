/**
 * Lo que las analíticas de un canal tienen dibujado, para mostrarlo sobre su vivo.
 *
 * Por qué existe (15/11, Nico, mirando un canal con siluetas y nada más: «¿y por qué no veo las
 * capas dibujadas en las analíticas en vivo?»). El vivo sólo dibujaba la línea y la zona de la
 * PROPIA cámara (AcuSense). Lo demás que mira ese canal existía, trabajaba sobre ese video y no
 * se veía en ningún lado fuera de su pantalla de configuración:
 *
 *   · las reglas propias de OmniVision (intrusión, permanencia, fila…): su zona o su línea;
 *   · las analíticas entrenables (un «vigía»): su zona, y en qué estado la ve AHORA;
 *   · la lectura de matrículas de nuestro lector: la zona de interés y la línea de pasada.
 *
 * Este archivo no habla con la base: arma la respuesta a partir de lo guardado, que viene en tres
 * formatos distintos (puntos [x, y], un rectángulo { x, y, w, h }, una línea { x1, y1, x2, y2 }),
 * y la deja en uno solo: puntos en fracciones del cuadro, de 0 a 1.
 */
import { poligonoValido } from "@/lib/zona-evento";
import { TIPOS_REGLA, type TipoRegla } from "@/lib/vision-reglas";

export type Pt = [number, number];
export type CapasCanal = {
    reglas: { id: string; nombre: string; tipo: string; activa: boolean; zona: Pt[] | null; linea: [Pt, Pt] | null }[];
    entrenables: { id: string; nombre: string; positivo: string; negativo: string; activa: boolean; zona: Pt[]; prob: number | null; al: string | null; avisa: boolean }[];
    lectura: { zona: Pt[] | null; linea: [Pt, Pt] | null } | null;
};

const frac = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null);
const punto = (p: unknown): Pt | null => {
    if (!Array.isArray(p) || p.length < 2) return null;
    const x = frac(p[0]), y = frac(p[1]);
    return x == null || y == null ? null : [x, y];
};
const json = (t: unknown): unknown => { if (typeof t !== "string") return t ?? null; try { return JSON.parse(t); } catch { return null; } };

/**
 * El estado de una entrenable, como lo deja su worker (vision-zonas.js). «Avisa» no es
 * «probabilidad ≥ umbral»: el worker entra al estado que avisa al pasar el umbral y sale recién
 * 0,15 más abajo (histéresis), y lo anota en `positivoDesde`. Se lee eso, para decir acá lo
 * mismo que decide él.
 */
export function estadoDeZona(e: unknown): { prob: number | null; al: string | null; avisa: boolean } {
    const x = (e && typeof e === "object" ? e : {}) as { prob?: unknown; al?: unknown; positivoDesde?: unknown };
    return { prob: typeof x.prob === "number" && Number.isFinite(x.prob) ? x.prob : null, al: typeof x.al === "string" ? x.al : null, avisa: !!x.positivoDesde };
}

export function capasDelCanal(id: string, datos: {
    /** El valor de Setting VISION_REGLAS, crudo. */
    reglas: unknown;
    zonas: { id: string; nombre: string; deviceId: string; zona: unknown; positivo: string; negativo: string; activa: boolean; estado: unknown }[];
    equipo: { deviceType?: string | null; trackEnabled?: boolean | null; trackRoi?: unknown; trackLine?: unknown } | null;
}): CapasCanal {
    const todas = json(datos.reglas);
    const reglas: CapasCanal["reglas"] = [];
    for (const r of Array.isArray(todas) ? todas : []) {
        if (!r || typeof r !== "object" || r.deviceId !== id) continue;
        const zona = poligonoValido(r.zona), a = punto(r.linea?.a), b = punto(r.linea?.b);
        const linea: [Pt, Pt] | null = a && b ? [a, b] : null;
        if (!zona && !linea) continue; // una regla de cuadro entero (aglomeración sin zona) no tiene qué dibujar
        reglas.push({ id: String(r.id), nombre: String(r.nombre || "").slice(0, 60), tipo: TIPOS_REGLA[r.tipo as TipoRegla]?.nombre || "Regla", activa: r.activa !== false, zona, linea });
    }

    const entrenables: CapasCanal["entrenables"] = [];
    for (const z of datos.zonas) {
        const zona = z.deviceId === id ? poligonoValido(z.zona) : null;
        if (zona) entrenables.push({ id: z.id, nombre: z.nombre, positivo: z.positivo, negativo: z.negativo, activa: z.activa, zona, ...estadoDeZona(z.estado) });
    }

    // La lectura de nuestro lector (tracking-worker): la zona es un rectángulo y la línea dos extremos.
    let lectura: CapasCanal["lectura"] = null;
    if (datos.equipo?.deviceType === "LPR_INTERIOR" && datos.equipo.trackEnabled) {
        const r = json(datos.equipo.trackRoi) as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | null;
        const l = json(datos.equipo.trackLine) as { x1?: unknown; y1?: unknown; x2?: unknown; y2?: unknown } | null;
        const x = frac(r?.x), y = frac(r?.y), w = frac(r?.w), h = frac(r?.h);
        const a = l ? punto([l.x1, l.y1]) : null, b = l ? punto([l.x2, l.y2]) : null;
        const zona: Pt[] | null = x != null && y != null && w != null && h != null && w > 0 && h > 0
            ? [[x, y], [Math.min(1, x + w), y], [Math.min(1, x + w), Math.min(1, y + h)], [x, Math.min(1, y + h)]] : null;
        const linea: [Pt, Pt] | null = a && b ? [a, b] : null;
        if (zona || linea) lectura = { zona, linea };
    }
    return { reglas, entrenables, lectura };
}

export const hayCapas = (c: CapasCanal | null | undefined) => !!c && (c.reglas.length > 0 || c.entrenables.length > 0 || !!c.lectura);
