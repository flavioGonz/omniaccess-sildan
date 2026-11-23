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

/* ---------- La huella ---------- */

/**
 * Cuánto dura la huella que deja un vehículo que anda (23/11, Nico mirando el auto en vivo: «debe
 * marcar el recorrido, ¿no?»). Diez minutos: alcanza para ver de dónde viene y por dónde dobló, y
 * no deja el mapa lleno de líneas de todo lo que anduvo en el día — para eso está el recorrido.
 */
export const HUELLA_MS = 10 * 60_000;
/** Lo de los últimos minutos va a pleno; lo anterior, tenue: la línea dice también para dónde va. */
export const HUELLA_FRESCA_MS = 3 * 60_000;
/** Sin reportes por más de esto, lo de antes y lo de después no se unen: en el medio no se sabe por dónde fue. */
export const HUELLA_HUECO_MS = 60_000;

/**
 * La huella en el instante `tp`: por dónde YA se dibujó al vehículo, en dos tramos —lo viejo y lo
 * fresco— que se tocan en un punto para que no quede un hueco entre los dos tonos.
 *
 * Termina en `cabeza`, que es donde está dibujado el vehículo ahora (va unos segundos detrás de la
 * última posición conocida): si la línea llegara hasta la última, el auto andaría persiguiendo una
 * línea que ya está pintada.
 */
export function huellaEn(rastro: Punto[], tp: number, cabeza: { lat: number; lon: number } | null): { vieja: [number, number][]; fresca: [number, number][] } {
    const desde = tp - HUELLA_MS, corte = tp - HUELLA_FRESCA_MS;
    const vieja: [number, number][] = [], fresca: [number, number][] = [];
    for (const p of rastro) {
        if (p.t > tp || p.t < desde) continue;
        const ll: [number, number] = [p.lat, p.lon];
        if (p.t <= corte) vieja.push(ll);
        else { if (!fresca.length && vieja.length) fresca.push(vieja[vieja.length - 1]); fresca.push(ll); }
    }
    if (cabeza && (vieja.length || fresca.length)) {
        if (!fresca.length) fresca.push(vieja[vieja.length - 1]);
        fresca.push([cabeza.lat, cabeza.lon]);
    }
    return { vieja: vieja.length > 1 ? vieja : [], fresca: fresca.length > 1 ? fresca : [] };
}

/**
 * De una tanda de posiciones (las de los últimos minutos, al abrir el mapa), el tramo final que
 * es UN solo camino: se corta en el último hueco largo. Lo de antes del hueco es otro viaje.
 */
export function colaSeguida(p: Punto[]): Punto[] {
    let i = p.length - 1;
    while (i > 0 && p[i].t - p[i - 1].t <= HUELLA_HUECO_MS) i--;
    return p.slice(Math.max(i, 0));
}
