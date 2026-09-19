/**
 * Lo que se sabe de dónde estaba el vehículo en el cuadro.
 *
 * El detector que corre en Omni-LPR es de MATRÍCULAS, no de vehículos: lo único que
 * devuelve — y lo único que guardamos — es el rectángulo de la chapa, en fracciones del
 * cuadro. Dibujarlo es dibujar un dato.
 *
 * De ahí sale también una caja aproximada del auto, y conviene tener claro de dónde:
 * la matrícula uruguaya mide 33 × 13 cm y esa medida conocida convierte píxeles en
 * metros. Con la regla puesta, un auto mide alrededor de 1,78 m de ancho por 1,45 m de
 * alto, y su chapa va centrada, con el centro a unos 51 cm del piso. Eso alcanza para
 * ubicar el vehículo en el cuadro; no alcanza para medirlo, porque la cuenta supone que
 * la chapa mira de frente a la cámara y no corrige ni la inclinación ni el ángulo. Por
 * eso la caja se dibuja punteada y rotulada: es una estimación, y tiene que verse como tal.
 *
 * El contorno real del vehículo pide un segundo modelo (YOLO COCO, clases car/truck/bus)
 * corriendo junto al de chapas. Es una decisión de costo por cuadro, no una de dibujo.
 */

export type Recuadro = { x: number; y: number; w: number; h: number; ar?: number };

/** Medidas reales, en metros. */
const CHAPA_ANCHO = 0.33;
const AUTO_ANCHO = 1.78;
const AUTO_ALTO = 1.45;
/** Altura del centro de la matrícula sobre el piso. */
const CHAPA_ALTURA = 0.51;

export function leerRecuadro(bbox: unknown): Recuadro | null {
    if (!bbox) return null;
    let v: any = bbox;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
    if (!v || typeof v !== "object") return null;
    const { x, y, w, h } = v;
    if (![x, y, w, h].every((n) => typeof n === "number" && isFinite(n))) return null;
    if (!(w > 0 && h > 0)) return null;
    return { x, y, w, h, ar: typeof v.ar === "number" && v.ar > 0 ? v.ar : undefined };
}

/**
 * La caja estimada del vehículo a partir de la de su chapa.
 * Devuelve null si no hay con qué: sin la proporción del cuadro no hay regla vertical.
 */
export function cajaVehiculo(r: Recuadro | null): Recuadro | null {
    if (!r) return null;
    const ar = r.ar || 16 / 9;
    const kx = r.w / CHAPA_ANCHO;      // fracción de ancho por metro
    const ky = kx * ar;                 // fracción de alto por metro
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const W = AUTO_ANCHO * kx;
    const H = AUTO_ALTO * ky;
    const abajo = cy + CHAPA_ALTURA * ky;
    return { x: cx - W / 2, y: abajo - H, w: W, h: H };
}

/** Qué fracción del cuadro ocupa la chapa. Es lo que decide si el lector la puede leer. */
export function porcionDelCuadro(r: Recuadro | null): number | null {
    return r ? r.w : null;
}
