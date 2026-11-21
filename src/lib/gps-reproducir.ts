/**
 * Dónde dibujar un vehículo en un instante, dado el camino que se le conoce.
 *
 * Es la cuenta que hace que el marcador ANDE en vez de saltar (components/mapa/CapaGps): cada
 * posición trae su hora, y el dibujo va un rato detrás de la realidad, así que en casi todo
 * momento cae ENTRE dos posiciones conocidas y sólo hay que interpolar. Está acá, suelta, para
 * poder probarla con los intervalos reales del equipo sin abrir un navegador.
 */

export type Punto = { t: number; lat: number; lon: number };

/**
 * Cuánto más atrás que la realidad se dibuja el vehículo.
 *
 * Medido el 21/11 sobre 374 posiciones andando: el equipo reporta cada 10 s (69 % de las veces),
 * a veces a los 4–5 s (15 %, cuando dobla) y casi nunca más de 12 (5 %); y la posición tarda unos
 * 2 s en llegar al servidor. Con 13 s de retraso, cuando el dibujo llega a una posición la
 * siguiente ya está en la mano, así que no tiene que frenar a esperarla.
 */
export const RETRASO_MS = 13_000;

/**
 * La posición en el instante `tp` (misma escala que `t`). `llego` avisa que `tp` ya pasó la
 * última posición conocida: el vehículo queda ahí, quieto, hasta que llegue otra.
 */
export function posicionEn(cola: Punto[], tp: number): { lat: number; lon: number; llego: boolean } | null {
    if (!cola.length) return null;
    const fin = cola[cola.length - 1];
    if (tp >= fin.t) return { lat: fin.lat, lon: fin.lon, llego: true };
    if (tp <= cola[0].t) return { lat: cola[0].lat, lon: cola[0].lon, llego: false };
    let i = cola.length - 2;
    while (i > 0 && cola[i].t > tp) i--;
    const a = cola[i], b = cola[i + 1], k = (tp - a.t) / Math.max(1, b.t - a.t);
    return { lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k, llego: false };
}
