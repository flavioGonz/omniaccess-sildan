/**
 * El croquis de los lotes del complejo, y cómo se pasa de un punto del croquis a la Tierra (25/11).
 *
 * Lo que llegó: un artefacto con el «Croquis comercial unificado» de San Nicolás (una imagen de
 * 5374 × 7654 px de la lámina de 910 × 1296 mm a 1:1000, o sea 150 ppp) y, para cada solar, el punto
 * donde está su número en esa imagen. Nico: «según me dieron, es exacto». Son coordenadas del
 * DIBUJO, no de la Tierra: sirven tal cual para marcar los lotes sobre el croquis, y para llevarlos al
 * mapa hace falta saber dónde cae el croquis.
 *
 * La calibración se sacó de lo que ya estaba en el mapa del lab: 82 casas dibujadas a mano sobre el
 * satélite y 22 tramos de calle. Se buscó el giro y el corrimiento que mejor llevan esas 82 casas
 * sobre los puntos del croquis, dejando la escala libre para ver si daba la del plano. Dio:
 *   · escala 1,0028 (la esperada era 1,0000: 1 px = 0,1693 m): confirma que el calce es el bueno.
 *   · giro de 6,66°: el croquis no está dibujado con el norte exacto arriba.
 *   · error típico de 4,6 m entre el centro de cada casa y el número de su solar (el número no va en
 *     el centro de la casa, así que es del orden de lo que se espera), y las calles del mapa caen
 *     sobre las calles del croquis.
 * Lo comprobado es la mitad norte (etapas 1-3 al este, 4-5 y la 7ª), que es donde hay casas y
 * calles dibujadas. La mitad sur no tiene nada en el mapa contra qué compararla.
 *
 * La cuenta, para quien la tenga que rehacer: un punto (lat, lng) se pasa a metros alrededor de
 * (lat0, lon0); se gira con R, se escala con s y se corre con t; eso da metros del croquis, que en
 * píxeles son x = X / S, y = −Y / S (en la imagen la y crece hacia abajo). Al revés para ir del
 * croquis a la Tierra.
 */

export type Georef = {
    /** Escala del calce (≈ 1) y la matriz de giro 2×2, de metros del mapa a metros del croquis. */
    s: number; R: [[number, number], [number, number]];
    /** Corrimiento, en metros del croquis. */
    t: [number, number];
    /** El punto de referencia de los metros del mapa, y cuántos metros tiene un grado allí. */
    lat0: number; lon0: number; KX: number; KY: number;
    /** Metros por píxel del croquis (0,1693 a 1:1000 y 150 ppp). */
    S: number;
};

export type PlanoLotes = {
    /** Cómo se llama el dibujo, para decirlo en pantalla. */
    titulo: string;
    /** El archivo de la imagen dentro de la carpeta de planos del servidor. */
    archivo: string;
    /** Tamaño de la imagen original, en píxeles: los puntos de los lotes están en esta escala. */
    ancho: number; alto: number;
    georef: Georef | null;
};

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** Lee la Setting PLANO_LOTES. Lo que no cierra se descarta entero: un plano a medias dibuja lotes donde no van. */
export function leerPlanoLotes(v: unknown): PlanoLotes | null {
    let o: Record<string, unknown>;
    try { o = typeof v === "string" ? JSON.parse(v) : (v as Record<string, unknown>); } catch { return null; }
    if (!o || typeof o !== "object") return null;
    const ancho = num(o.ancho), alto = num(o.alto);
    const archivo = typeof o.archivo === "string" && /^[\w.-]+\.(jpe?g|png|webp)$/i.test(o.archivo) ? o.archivo : null;
    if (!ancho || !alto || !archivo) return null;
    return { titulo: typeof o.titulo === "string" ? o.titulo.slice(0, 120) : "Croquis de los lotes", archivo, ancho, alto, georef: leerGeoref(o.georef) };
}

function leerGeoref(v: unknown): Georef | null {
    const g = v as Record<string, unknown> | null;
    if (!g || typeof g !== "object") return null;
    const R = g.R as unknown[];
    const vals = [g.s, g.lat0, g.lon0, g.KX, g.KY, g.S].map(num);
    const t = Array.isArray(g.t) ? (g.t as unknown[]).map(num) : [];
    const r = Array.isArray(R) && R.length === 2 ? R.flatMap((f) => (Array.isArray(f) && f.length === 2 ? f.map(num) : [null, null])) : [];
    if (vals.some((x) => x === null) || t.length !== 2 || t.some((x) => x === null) || r.length !== 4 || r.some((x) => x === null)) return null;
    const [s, lat0, lon0, KX, KY, S] = vals as number[];
    const [a, b, c, d] = r as number[];
    return { s, R: [[a, b], [c, d]], t: [t[0]!, t[1]!], lat0, lon0, KX, KY, S };
}

/** De un punto del croquis (píxeles) a la Tierra. */
export function planoALatLng(x: number, y: number, g: Georef): { lat: number; lng: number } {
    const X = x * g.S - g.t[0], Y = -y * g.S - g.t[1];
    // Inversa de s·R: R es un giro (su inversa es su traspuesta).
    const qx = (g.R[0][0] * X + g.R[1][0] * Y) / g.s, qy = (g.R[0][1] * X + g.R[1][1] * Y) / g.s;
    return { lat: g.lat0 + qy / g.KY, lng: g.lon0 + qx / g.KX };
}

/** De la Tierra a un punto del croquis (píxeles). */
export function latLngAPlano(lat: number, lng: number, g: Georef): { x: number; y: number } {
    const qx = (lng - g.lon0) * g.KX, qy = (lat - g.lat0) * g.KY;
    const X = g.s * (g.R[0][0] * qx + g.R[0][1] * qy) + g.t[0], Y = g.s * (g.R[1][0] * qx + g.R[1][1] * qy) + g.t[1];
    return { x: X / g.S, y: -Y / g.S };
}

/** Cómo se guarda en `Unit.coordinates`: «lat, lng» con seis decimales (unos 10 cm), como lo leen las invitaciones. */
export const coordenadasDeTexto = (p: { lat: number; lng: number }) => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
