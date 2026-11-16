/**
 * Matrículas sobre los vehículos del vivo, en cámaras que no son lectoras.
 *
 * Por qué, y hasta dónde (16/11, Nico: «no veo que detectes varias chapas en vivo y las estés
 * dibujando»). Medido ese día en dos cámaras de vista general del lab (2688×1520), recortando
 * cada vehículo y pasándolo por el lector: se encontró una chapa en 21 de 42 recortes, con texto
 * de 6 letras o más en 10, y NINGUNA con confianza de 0,8. Las chapas miden 20 a 30 px de ancho y
 * el lector necesita unos 100. De ahí las dos reglas:
 *
 *  · El RECUADRO de la chapa se dibuja apenas se la encuentra: dónde está no depende de leerla.
 *  · El TEXTO sale sólo cuando es de fiar, con la misma vara que el motor de lecturas
 *    (tracking-worker): dos lecturas iguales de 0,60 o más, o una sola de 0,85. En estas cámaras
 *    eso es poco; en una bien encuadrada, casi siempre. Un texto dudoso no se muestra: una
 *    matrícula equivocada con aspecto de leída es peor que ninguna.
 *
 * «Sin chapa» NO se decide acá: en esa misma medición no se encontró chapa en 11 de los 15
 * vehículos grandes, y casi todos la tenían (estaban de costado o tapados).
 *
 * Esto es sólo la memoria de una sesión de vivo: a qué vehículo se le leyó qué. Sin red ni base.
 */

/** La vara del motor de lecturas (tracking-worker: MIN_CONF, COINCIDENCIAS_MIN, CONF_ALTA). */
export const CONFIANZA_MIN = 0.6, COINCIDENCIAS = 2, CONFIANZA_SOLA = 0.85;
/** Una matrícula uruguaya o del Mercosur tiene 6 o 7 caracteres: menos es ruido. */
const LARGO_MIN = 6, LARGO_MAX = 8;
/** Cuántas veces se le pide lectura a un mismo vehículo quieto. Después se lo deja en paz. */
export const INTENTOS_MAX = 6;
/** Recortes por vuelta: el lector es uno solo y lo comparte con el seguimiento. */
export const POR_VUELTA = 3;
/** Cuánto se tienen que pisar dos cajas para ser el mismo vehículo en el mismo lugar. */
const MISMO_IOU = 0.5;
/** Sin verlo este tiempo, se olvida. */
const OLVIDO_MS = 20_000;
/** Un vehículo más chico que esto (fracción del alto del cuadro) no tiene chapa legible: ni se intenta. */
export const ALTO_MIN = 0.07;

export type Caja = [number, number, number, number];
export type LecturaEnVivo = { texto: string; confianza: number; caja: Caja };
type Recuerdo = { caja: Caja; visto: number; intentos: number; votos: Map<string, number>; texto: string | null; chapa: Caja | null };

function iou(a: number[], b: number[]): number {
    const i = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i;
    return u > 0 ? i / u : 0;
}
export const limpiar = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function memoriaDeChapas() {
    let lista: Recuerdo[] = [];
    const de = (caja: number[]) => { let m: Recuerdo | null = null, v = MISMO_IOU; for (const r of lista) { const x = iou(r.caja, caja); if (x >= v) { m = r; v = x; } } return m; };
    return {
        /** Los vehículos del último análisis: se recuerdan los que siguen, se olvidan los que se fueron. Devuelve a cuáles leer ahora. */
        pendientes(vehiculos: number[][], ahora: number): Caja[] {
            for (const c of vehiculos) { const r = de(c); if (r) { r.caja = c as Caja; r.visto = ahora; } else lista.push({ caja: c as Caja, visto: ahora, intentos: 0, votos: new Map(), texto: null, chapa: null }); }
            lista = lista.filter((r) => ahora - r.visto <= OLVIDO_MS);
            return lista.filter((r) => r.visto === ahora && !r.texto && r.intentos < INTENTOS_MAX && r.caja[3] - r.caja[1] >= ALTO_MIN)
                // Primero a los que menos se les pidió, y entre ellos los más grandes: son los más legibles.
                .sort((a, b) => a.intentos - b.intentos || (b.caja[3] - b.caja[1]) - (a.caja[3] - a.caja[1])).slice(0, POR_VUELTA).map((r) => r.caja);
        },
        /** Lo que dijo el lector de ese vehículo (la caja de la chapa, en fracciones del CUADRO). Null = no encontró chapa. */
        anotar(vehiculo: number[], lectura: LecturaEnVivo | null): void {
            const r = de(vehiculo); if (!r) return;
            r.intentos++;
            if (!lectura) return;
            // La chapa se guarda respecto del vehículo: si el auto se corre un poco, el recuadro va con él.
            const w = r.caja[2] - r.caja[0] || 1, h = r.caja[3] - r.caja[1] || 1;
            r.chapa = [(lectura.caja[0] - r.caja[0]) / w, (lectura.caja[1] - r.caja[1]) / h, (lectura.caja[2] - r.caja[0]) / w, (lectura.caja[3] - r.caja[1]) / h];
            const t = limpiar(lectura.texto);
            if (t.length < LARGO_MIN || t.length > LARGO_MAX || lectura.confianza < CONFIANZA_MIN) return;
            const n = (r.votos.get(t) || 0) + 1; r.votos.set(t, n);
            if (n >= COINCIDENCIAS || lectura.confianza >= CONFIANZA_SOLA) r.texto = t;
        },
        /** Lo que hay que dibujar sobre ese vehículo: el recuadro, y el texto si ya es de fiar (si no, vacío). */
        de(vehiculo: number[]): { plate: string; caja: Caja } | null {
            const r = de(vehiculo); if (!r?.chapa) return null;
            const [x1, y1, x2, y2] = vehiculo, w = x2 - x1, h = y2 - y1, f = (v: number) => Math.max(0, Math.min(1, v));
            return { plate: r.texto || "", caja: [f(x1 + r.chapa[0] * w), f(y1 + r.chapa[1] * h), f(x1 + r.chapa[2] * w), f(y1 + r.chapa[3] * h)] };
        },
    };
}
