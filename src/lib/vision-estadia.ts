/**
 * El tiempo estacionado sobre el auto, en el vivo (12/11). vision-worker lleva la cuenta de qué
 * vehículos están en su lugar y desde cuándo (lib-lugares-vehiculos.js) y la publica; acá se cruza
 * con lo que el vivo está dibujando. Sin base ni red: lo usan la ruta del vivo, la capa y los tests.
 */

/** [x1, y1, x2, y2, desdeMs]: como lo publica vision-worker. */
export type LugarVehiculo = [number, number, number, number, number];
/**
 * Cuánto se tienen que pisar la caja del vivo y la del lugar para ser el mismo auto. Más bajo que
 * el 0,6 con que el worker decide «mismo lugar»: las dos cajas salen de cuadros distintos (el del
 * vivo es de ahora, el del worker puede tener un minuto) y de análisis distintos.
 */
export const CRUCE_IOU = 0.45;

function iou(a: number[], b: number[]): number {
    const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
    const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i;
    return u > 0 ? i / u : 0;
}

/**
 * A cada vehículo del cuadro le pone desde cuándo está en su lugar, si el worker lo tiene anotado.
 * Cada lugar se usa una vez (el que más se pisa), así dos autos pegados no heredan el mismo reloj.
 */
export function conEstadia<T extends { grupo: string; caja: number[] }>(objetos: T[], lugares: LugarVehiculo[] | undefined): (T & { quietoDesde?: number })[] {
    if (!lugares?.length) return objetos;
    const pares: { o: number; l: number; v: number }[] = [];
    objetos.forEach((o, i) => { if (o.grupo === "vehiculo" && o.caja?.length === 4) lugares.forEach((l, j) => { const v = iou(o.caja, l); if (v >= CRUCE_IOU) pares.push({ o: i, l: j, v }); }); });
    pares.sort((a, b) => b.v - a.v);
    const usadoO = new Set<number>(), usadoL = new Set<number>(), desde = new Map<number, number>();
    for (const p of pares) { if (usadoO.has(p.o) || usadoL.has(p.l)) continue; usadoO.add(p.o); usadoL.add(p.l); desde.set(p.o, lugares[p.l][4]); }
    return objetos.map((o, i) => (desde.has(i) ? { ...o, quietoDesde: desde.get(i)! } : o));
}

/** «14 min», «2 h 05», «1 d 3 h»: cuánto lleva, corto, para leerlo sobre el video. */
export function textoEstadia(ms: number): string {
    const min = Math.floor(ms / 60_000);
    if (min < 60) return `${Math.max(1, min)} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} h ${String(min % 60).padStart(2, "0")}`;
    return `${Math.floor(h / 24)} d ${h % 24} h`;
}
