/**
 * Lo que omni-vision vio en una foto, y si lo que vio toca una línea o una zona.
 *
 * Lo usan la verificación de intrusión (¿lo que cruzó la línea de la cámara es una persona?) y
 * el análisis de las lecturas LPR. Las coordenadas vienen normalizadas (0-1) como las devuelve
 * omni-vision; las cuentas se hacen en PÍXELES (× ancho, × alto), porque en una foto 16:9 una
 * distancia de 0,01 en x no es la misma que 0,01 en y.
 *
 * «Toca» mira la SILUETA cuando hay (la segmentación) y la caja cuando no: una persona al lado
 * de la línea cuya caja la pisa por un brazo no es lo mismo que una que la está cruzando.
 *
 * Archivo sin base ni red: lo usan rutas, pantallas y pruebas.
 */

export type Pt = [number, number];
export type ObjetoAnalizado = {
    clase: string; nombre: string; grupo: string; confianza: number;
    caja: [number, number, number, number];
    silueta?: Pt[][] | null;
    atributos?: { id: string; nombre: string; valor: string; prob: number; dudoso: boolean }[] | null;
};
export type Analisis = { ancho: number; alto: number; objetos: ObjetoAnalizado[]; tarea?: string;
    /** Doble verificación: el cuadro propio del canal, sacado unos segundos después (clave en MinIO). */
    propio?: { foto: string; despuesMs: number; ancho: number; alto: number; objetos: ObjetoAnalizado[]; tarea?: string } | null };
/**
 * Línea (polilínea) y zona (polígono), normalizadas 0-1. `otras`: las demás líneas y zonas
 * prendidas de la cámara (hasta 4 de cada una, 23/10); el veredicto las mira todas.
 */
export type GeomNorm = { linea: Pt[]; zona: Pt[]; otras?: { lineas: Pt[][]; zonas: Pt[][] } };

/** Lo que cuenta para confirmar una intrusión: gente y vehículos. Un perro solo es otra cosa. */
export const GRUPOS_RELEVANTES = new Set(["persona", "vehiculo"]);
/**
 * Medio ancho de la franja alrededor de la línea, como fracción del lado corto de la foto. La
 * captura llega una fracción de segundo después del cruce: alguien que la está pasando puede
 * tener el cuerpo apenas del otro lado. 1,5 % de 1080 px son 16 px.
 */
export const BANDA_LINEA = 0.015;
/** Más puntos que esto por silueta no se ven y pesan en la base y en la pantalla. */
export const PUNTOS_SILUETA_MAX = 80;

/** La geometría del monitor de intrusión (0-100) a la de acá (0-1). */
export function geomDeIntrusion(g: { line?: { x: number; y: number }[]; field?: { x: number; y: number }[]; lines?: { x: number; y: number }[][]; fields?: { x: number; y: number }[][] } | null | undefined): GeomNorm | null {
    if (!g) return null;
    const norm = (l: { x: number; y: number }[]) => l.map((p) => [p.x / 100, p.y / 100] as Pt);
    const lineas = (g.lines && g.lines.length ? g.lines : g.line ? [g.line] : []).map(norm).filter((l) => l.length >= 2);
    const zonas = (g.fields && g.fields.length ? g.fields : g.field ? [g.field] : []).map(norm).filter((z) => z.length >= 3);
    if (!lineas.length && !zonas.length) return null;
    const otras = lineas.length > 1 || zonas.length > 1 ? { lineas: lineas.slice(1), zonas: zonas.slice(1) } : undefined;
    return { linea: lineas[0] || [], zona: zonas[0] || [], ...(otras ? { otras } : {}) };
}

export function poligonos(o: ObjetoAnalizado): Pt[][] {
    if (o.silueta && o.silueta.some((p) => p.length >= 3)) return o.silueta.filter((p) => p.length >= 3);
    const [x1, y1, x2, y2] = o.caja;
    return [[[x1, y1], [x2, y1], [x2, y2], [x1, y2]]];
}

const enPx = (p: Pt, w: number, h: number): Pt => [p[0] * w, p[1] * h];
const cruz = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function seCortan(p: Pt, q: Pt, a: Pt, b: Pt): boolean {
    const d1 = cruz(a, b, p), d2 = cruz(a, b, q), d3 = cruz(p, q, a), d4 = cruz(p, q, b);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
export function adentro(p: Pt, poli: Pt[]): boolean {
    let dentro = false;
    for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
        const [xi, yi] = poli[i], [xj, yj] = poli[j];
        if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
}
function distSeg(p: Pt, a: Pt, b: Pt): number {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
const aristas = (poli: Pt[]) => poli.map((p, i) => [p, poli[(i + 1) % poli.length]] as [Pt, Pt]);

export function tocaLinea(o: ObjetoAnalizado, linea: Pt[], ancho: number, alto: number): boolean {
    if (linea.length < 2) return false;
    const L = linea.map((p) => enPx(p, ancho, alto));
    const banda = BANDA_LINEA * Math.min(ancho, alto);
    for (const poli0 of poligonos(o)) {
        const poli = poli0.map((p) => enPx(p, ancho, alto));
        for (let i = 0; i < L.length - 1; i++) {
            const a = L[i], b = L[i + 1];
            if (adentro(a, poli) || adentro(b, poli)) return true;
            if (aristas(poli).some(([p, q]) => seCortan(p, q, a, b))) return true;
            if (poli.some((p) => distSeg(p, a, b) <= banda)) return true;
        }
    }
    return false;
}

export function tocaZona(o: ObjetoAnalizado, zona: Pt[], ancho: number, alto: number): boolean {
    if (zona.length < 3) return false;
    const Z = zona.map((p) => enPx(p, ancho, alto));
    for (const poli0 of poligonos(o)) {
        const poli = poli0.map((p) => enPx(p, ancho, alto));
        if (poli.some((p) => adentro(p, Z)) || Z.some((p) => adentro(p, poli))) return true;
        if (aristas(poli).some(([p, q]) => aristas(Z).some(([a, b]) => seCortan(p, q, a, b)))) return true;
    }
    return false;
}

/** Las franjas alrededor de cada tramo de la línea (para recortar «la parte que toca», en píxeles). */
export function bandasLinea(linea: Pt[], ancho: number, alto: number): Pt[][] {
    const L = linea.map((p) => enPx(p, ancho, alto));
    const w = BANDA_LINEA * Math.min(ancho, alto);
    const out: Pt[][] = [];
    for (let i = 0; i < L.length - 1; i++) {
        const [a, b] = [L[i], L[i + 1]];
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const n: Pt = [(-(b[1] - a[1]) / d) * w, ((b[0] - a[0]) / d) * w];
        out.push([[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]]);
    }
    return out;
}

export type Veredicto = "CONFIRMADA" | "PRESENTE" | "ANIMAL" | "NADA";
export const VEREDICTOS: Record<Veredicto, { rotulo: string; tono: "mal" | "aviso" | "quieto" | "bien"; explica: string }> = {
    CONFIRMADA: { rotulo: "Confirmada", tono: "mal", explica: "Una persona o un vehículo toca la línea o la zona en la captura." },
    PRESENTE: { rotulo: "Hay alguien", tono: "aviso", explica: "Se ve una persona o un vehículo, pero en la captura no toca la línea ni la zona (o la cámara no informa dónde están)." },
    ANIMAL: { rotulo: "Animal", tono: "quieto", explica: "Sólo se ve un animal: probablemente una falsa alarma." },
    NADA: { rotulo: "No se ve a nadie", tono: "quieto", explica: "omni-vision no encontró personas, vehículos ni animales en la captura." },
};

/** De más fuerte a más débil: con dos fotos (captura y cuadro propio) vale la más fuerte. */
export const ORDEN_VEREDICTO: Veredicto[] = ["CONFIRMADA", "PRESENTE", "ANIMAL", "NADA"];

/**
 * El filtro por lo que vio omni-vision, igual en todas las listas de detecciones (monitor de
 * intrusión, cajón del monitor LPR, pared). Agrupa como piensa el guardia: «con alguien» es lo que
 * hay que mirar; «sin nadie» (sólo un animal o la escena vacía) es lo que probablemente es falsa;
 * «sin analizar» separa lo que omni-vision no miró —anterior al 9/10, sin foto o con error— de lo
 * que miró y no encontró nada, que antes se confundían.
 */
export type FiltroVision = "todas" | "alguien" | "nadie" | "sin";
export const FILTROS_VISION: { v: FiltroVision; rotulo: string; pista: string }[] = [
    { v: "todas", rotulo: "Todas", pista: "Sin filtrar por omni-vision." },
    { v: "alguien", rotulo: "Con alguien", pista: "omni-vision vio una persona o un vehículo: confirmada o «hay alguien»." },
    { v: "nadie", rotulo: "Sin nadie", pista: "Sólo un animal o la escena vacía: probablemente falsas." },
    { v: "sin", rotulo: "Sin analizar", pista: "omni-vision no la miró (todavía): anterior al 9/10, sin foto, con error o en cola." },
];
export function pasaVision(v: Veredicto | null | undefined, f: FiltroVision): boolean {
    if (f === "todas") return true;
    if (f === "sin") return !v;
    if (f === "alguien") return v === "CONFIRMADA" || v === "PRESENTE";
    return v === "ANIMAL" || v === "NADA";
}

/** El veredicto de una captura con la geometría de la cámara, y qué objetos tocan. */
export function veredicto(a: Analisis, g: GeomNorm | null): { estado: Veredicto; tocan: boolean[] } {
    const lineas = g ? [g.linea, ...(g.otras?.lineas || [])] : [];
    const zonas = g ? [g.zona, ...(g.otras?.zonas || [])] : [];
    const tocan = a.objetos.map((o) => !!g && GRUPOS_RELEVANTES.has(o.grupo) && (lineas.some((l) => tocaLinea(o, l, a.ancho, a.alto)) || zonas.some((z) => tocaZona(o, z, a.ancho, a.alto))));
    const relevantes = a.objetos.filter((o) => GRUPOS_RELEVANTES.has(o.grupo));
    // Sin la geometría de la cámara no se puede decir que algo TOCA la línea: a lo sumo que hay
    // alguien. «Confirmada» sólo cuando se pudo medir.
    const estado: Veredicto = tocan.some(Boolean) ? "CONFIRMADA"
        : relevantes.length ? "PRESENTE"
            : a.objetos.some((o) => o.grupo === "animal") ? "ANIMAL" : "NADA";
    return { estado, tocan };
}

/** Recorta una silueta a PUNTOS_SILUETA_MAX puntos tomando uno cada tanto (se ve igual). */
export function aligerar(poli: Pt[], max = PUNTOS_SILUETA_MAX): Pt[] {
    if (poli.length <= max) return poli;
    const paso = poli.length / max;
    return Array.from({ length: max }, (_, i) => poli[Math.floor(i * paso)]);
}
