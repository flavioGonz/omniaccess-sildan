/**
 * Las líneas y zonas de una cámara tal como llegan a las pantallas (0–100, origen arriba-izquierda).
 *
 * Una cámara Hikvision tiene hasta 4 líneas y 4 zonas (23/10). `line` / `field` traen la primera,
 * que es lo que entendían las pantallas viejas; `lines` / `fields`, todas las prendidas. Estas dos
 * funciones dan siempre la lista, venga como venga, para que cada dibujo no lo resuelva a su modo.
 */
type P = { x: number; y: number };
export type GeomVarias = { line?: P[] | null; field?: P[] | null; lines?: P[][] | null; fields?: P[][] | null };

export const lineasDe = (g: GeomVarias | null | undefined): P[][] =>
    (g?.lines && g.lines.length ? g.lines : g?.line ? [g.line] : []).filter((l) => l && l.length >= 2);

export const zonasDe = (g: GeomVarias | null | undefined): P[][] =>
    (g?.fields && g.fields.length ? g.fields : g?.field ? [g.field] : []).filter((z) => z && z.length >= 3);

export const tieneGeom = (g: GeomVarias | null | undefined) => lineasDe(g).length > 0 || zonasDe(g).length > 0;
