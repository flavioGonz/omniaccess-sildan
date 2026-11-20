/**
 * Las cuentas de un recorrido: cuánto anduvo, cuánto tiempo y a cuánto.
 *
 * Lo que hace falta cuidar es que **un GPS quieto no está quieto**: con doce satélites encima, el
 * equipo de Nico reportó estacionado tres posiciones separadas por quince metros. Sumando todos
 * los saltos, un auto que pasó la noche en el garage «recorre» kilómetros. Por eso un tramo sólo
 * cuenta si el equipo dice que se estaba moviendo, o si el salto es demasiado grande para ser
 * ruido.
 */

export type PuntoRecorrido = { lat: number; lon: number; cuando: string; velocidad: number };
export type ResumenRecorrido = {
    km: number;
    /** Minutos con el vehículo en movimiento. */
    enMovimientoMin: number;
    velMax: number;
    desde: string | null;
    hasta: string | null;
    puntos: number;
};

/** Debajo de esto el equipo está detenido (el GPS quieto «camina» un par de km/h). */
const VEL_MOVIMIENTO = 4;
/** Un salto mayor que esto entre dos reportes es un traslado aunque diga velocidad 0. */
const SALTO_REAL_M = 60;
/** Dos reportes más separados que esto no son un tramo: en el medio no se sabe qué pasó. */
const HUECO_MS = 5 * 60_000;

/** Metros entre dos puntos (haversine). */
export function metrosEntre(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

export function resumenDeRecorrido(p: PuntoRecorrido[]): ResumenRecorrido {
    let m = 0, movMs = 0, velMax = 0;
    for (let i = 1; i < p.length; i++) {
        const a = p[i - 1], b = p[i];
        const d = metrosEntre(a, b);
        const dt = new Date(b.cuando).getTime() - new Date(a.cuando).getTime();
        const andando = a.velocidad >= VEL_MOVIMIENTO || b.velocidad >= VEL_MOVIMIENTO;
        if (andando || d > SALTO_REAL_M) {
            m += d;
            /* El tiempo sólo se suma si los dos reportes son vecinos: si el equipo estuvo una hora
               sin reportar (un túnel, un estacionamiento), esa hora no fue «en movimiento». */
            if (andando && dt > 0 && dt <= HUECO_MS) movMs += dt;
        }
        if (b.velocidad > velMax) velMax = b.velocidad;
    }
    if (p.length && p[0].velocidad > velMax) velMax = p[0].velocidad;
    return {
        km: Math.round(m / 10) / 100, enMovimientoMin: Math.round(movMs / 60_000), velMax,
        desde: p[0]?.cuando || null, hasta: p[p.length - 1]?.cuando || null, puntos: p.length,
    };
}

/**
 * Menos puntos para dibujar, sin deformar el camino: se queda con uno de cada N, y siempre con el
 * primero y el último. Una semana andando son decenas de miles de puntos; el mapa no necesita más
 * que unos miles para que la línea se vea igual.
 */
export function aligerar<T>(p: T[], tope: number): T[] {
    if (p.length <= tope) return p;
    const paso = p.length / (tope - 1), r: T[] = [];
    for (let i = 0; i < tope - 1; i++) r.push(p[Math.floor(i * paso)]);
    r.push(p[p.length - 1]);
    return r;
}
