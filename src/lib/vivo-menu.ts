/**
 * El menú del objeto tocado en el vivo (13/11, Nico: «al hacerle clic, cuando muestra el tiempo,
 * que el auto tenga menú contextual: ver cuándo llegó, buscar parecidos, etiquetar como
 * sospechoso (alerta amarilla)»). Acá va lo que se puede probar sin pantalla: qué clase se busca
 * y cuál objeto de una foto es el que se tocó. (Desde dónde arranca la grabación de «ver cuándo
 * llegó» está en lib/vision-llegada.)
 *
 * Sin base ni red: lo usan la ficha del canal, la búsqueda de parecidos y las pruebas.
 */

export type ClaseBusqueda = "persona" | "vehiculo" | "animal" | "objeto";

/** La clase con que se buscan parecidos: los tres grupos que la búsqueda conoce; todo lo demás es «objeto». */
export function claseDeBusqueda(grupo: string): ClaseBusqueda {
    return grupo === "persona" || grupo === "vehiculo" || grupo === "animal" ? grupo : "objeto";
}

type Caja = number[];
function iou(a: Caja, b: Caja): number {
    const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    if (w <= 0 || h <= 0) return 0;
    const i = w * h;
    return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i);
}
/** Cuánto se tienen que pisar la caja tocada y la de la foto para ser el mismo objeto. */
export const MISMO_TOCADO_IOU = 0.3;

/**
 * De los objetos de una foto, el que se tocó en el vivo. La foto se saca medio segundo después
 * del toque y la analiza otra pasada: las cajas no coinciden exacto. Primero el que más se pisa
 * con la caja tocada; si ninguno (alguien caminando ya se corrió), el más cercano, siempre que su
 * centro esté a menos de una caja de distancia. Si no hay ninguno así, null: no se adivina.
 */
export function elegirPorCaja<T extends { caja: number[] }>(objetos: T[], caja: number[] | null | undefined): T | null {
    if (!caja || caja.length !== 4 || !objetos.length) return null;
    let mejor: T | null = null, m = MISMO_TOCADO_IOU;
    for (const o of objetos) { const v = iou(o.caja, caja); if (v >= m) { m = v; mejor = o; } }
    if (mejor) return mejor;
    const cx = (caja[0] + caja[2]) / 2, cy = (caja[1] + caja[3]) / 2, alcance = Math.hypot(caja[2] - caja[0], caja[3] - caja[1]);
    let d = alcance;
    for (const o of objetos) { const v = Math.hypot((o.caja[0] + o.caja[2]) / 2 - cx, (o.caja[1] + o.caja[3]) / 2 - cy); if (v < d) { d = v; mejor = o; } }
    return mejor;
}

/**
 * El motivo que se propone al marcar un vehículo desde el vivo: dónde y desde cuándo. Es lo que
 * después se lee en la captura cada vez que pasa, así que dice algo y el operador lo completa.
 */
export function motivoDesdeVivo(camara: string, quietoDesde: number | null | undefined, ahora = Date.now()): string {
    const base = `Sospechoso: marcado desde el vivo de ${camara.trim() || "una cámara"}`;
    if (!quietoDesde || quietoDesde > ahora) return base;
    const d = new Date(quietoDesde), hoy = new Date(ahora);
    const hora = d.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Montevideo" });
    const dia = d.toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit", timeZone: "America/Montevideo" });
    const mismoDia = dia === hoy.toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit", timeZone: "America/Montevideo" });
    return `${base}, en su lugar desde ${mismoDia ? "" : `el ${dia} a `}las ${hora}`;
}
