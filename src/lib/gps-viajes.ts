import { metrosEntre, type PuntoRecorrido } from "@/lib/gps-recorrido";

/**
 * Cortar un recorrido en VIAJES y PARADAS.
 *
 * Una línea de 24 horas sobre el mapa contesta «por dónde anduvo» y nada más. Lo que se pregunta
 * de un vehículo es otra cosa: cuántas veces salió, a qué hora, cuánto tardó, dónde paró y cuánto
 * tiempo. Eso no se ve en una línea; se ve en una lista.
 *
 * Las tres decisiones, y por qué:
 *  · **Un semáforo no es una parada.** Hace falta estar quieto PARADA_MIN para que el viaje
 *    termine; si no, un viaje por la ciudad sale partido en veinte.
 *  · **Un hueco largo sin reportes corta el viaje.** Si el equipo estuvo media hora mudo (un
 *    estacionamiento subterráneo), lo de antes y lo de después son dos viajes: en el medio no se
 *    sabe qué pasó, y unirlos inventaría un viaje de media hora que nadie hizo.
 *  · **Mover el auto dos metros no es un viaje.** Un viaje de menos de VIAJE_MIN_M se descarta:
 *    es el ruido del GPS disfrazado, o una maniobra en el garage.
 */

/** Desde esta velocidad se lo considera andando. */
const VEL_ANDANDO = 4;
/** Quieto este tiempo, el viaje terminó. Menos que esto es un semáforo o una espera. */
export const PARADA_MIN_MS = 4 * 60_000;
/** Sin reportes por este tiempo, el viaje se corta ahí. */
const HUECO_MS = 10 * 60_000;
/** Un viaje más corto que esto no es un viaje. */
const VIAJE_MIN_M = 150;
/**
 * Y además tiene que haberse ALEJADO esto de donde salió, en algún momento.
 *
 * La distancia recorrida sola no alcanza, y se vio con datos reales (21/11): un auto estacionado
 * con mala señal «camina» alrededor de su lugar y acumula cientos de metros de recorrido sin irse
 * nunca a más de una cuadra. Los viajes de verdad de esa misma prueba se alejaron entre 355 m y
 * 16 km; los fantasmas de la noche, que pasaban el filtro de satélites de a ratos, nunca más de
 * 342. El costo: una vuelta manzana que termina donde empezó no figura como viaje.
 */
export const ALEJARSE_M = 250;

export type Viaje = {
    desde: string; hasta: string;
    km: number;
    /** Minutos de punta a punta. */
    minutos: number;
    velMax: number;
    /** km/h promedio de punta a punta, contando las esperas del camino. */
    velMedia: number;
    inicio: { lat: number; lon: number };
    fin: { lat: number; lon: number };
};
export type Parada = { desde: string; hasta: string; minutos: number; lat: number; lon: number };

const t = (p: PuntoRecorrido) => new Date(p.cuando).getTime();

export function viajesYParadas(p: PuntoRecorrido[]): { viajes: Viaje[]; paradas: Parada[] } {
    const viajes: Viaje[] = [];
    let i0 = -1;            // dónde empezó el viaje en curso
    let ultMov = -1;        // el último punto en que se lo vio andando
    let m = 0, velMax = 0;
    let lejos = 0;          // lo más lejos que estuvo de donde arrancó

    const cerrar = () => {
        if (i0 >= 0 && ultMov > i0 && m >= VIAJE_MIN_M && lejos >= ALEJARSE_M) {
            const a = p[i0], b = p[ultMov];
            const min = Math.max(1, Math.round((t(b) - t(a)) / 60_000));
            viajes.push({
                desde: a.cuando, hasta: b.cuando, km: Math.round(m / 10) / 100, minutos: min, velMax,
                velMedia: Math.round((m / 1000) / (min / 60)),
                inicio: { lat: a.lat, lon: a.lon }, fin: { lat: b.lat, lon: b.lon },
            });
        }
        i0 = -1; ultMov = -1; m = 0; velMax = 0; lejos = 0;
    };

    for (let i = 0; i < p.length; i++) {
        const andando = p[i].velocidad >= VEL_ANDANDO;
        if (i0 >= 0) {
            const hueco = t(p[i]) - t(p[i - 1]);
            /* Se cierra con lo que había ANTES del hueco o de la parada: ese tramo no es del viaje. */
            if (hueco > HUECO_MS || t(p[i]) - t(p[ultMov]) >= PARADA_MIN_MS) { cerrar(); }
        }
        if (i0 < 0) {
            if (andando) { i0 = Math.max(0, i - 1); ultMov = i; m = i > 0 && t(p[i]) - t(p[i - 1]) <= HUECO_MS ? metrosEntre(p[i - 1], p[i]) : 0; velMax = p[i].velocidad; if (m === 0) i0 = i; lejos = metrosEntre(p[i0], p[i]); }
            continue;
        }
        m += metrosEntre(p[i - 1], p[i]);
        lejos = Math.max(lejos, metrosEntre(p[i0], p[i]));
        if (andando) { ultMov = i; if (p[i].velocidad > velMax) velMax = p[i].velocidad; }
    }
    cerrar();

    /* Una parada es lo que hay entre dos viajes: dónde quedó y cuánto tiempo. */
    const paradas: Parada[] = [];
    for (let k = 1; k < viajes.length; k++) {
        const a = viajes[k - 1], b = viajes[k];
        const min = Math.round((new Date(b.desde).getTime() - new Date(a.hasta).getTime()) / 60_000);
        if (min >= PARADA_MIN_MS / 60_000) paradas.push({ desde: a.hasta, hasta: b.desde, minutos: min, lat: a.fin.lat, lon: a.fin.lon });
    }
    return { viajes, paradas };
}

/**
 * Las cuentas del tramo, sacadas de los VIAJES y no de sumar punto por punto.
 *
 * Antes eran dos cuentas separadas —una sumaba tramos, la otra cortaba viajes— y con datos reales
 * no coincidían: el panel decía 48,8 km y los viajes de verdad sumaban 37,5. Lo que no fue parte
 * de un viaje no es distancia recorrida; es ruido alrededor de un auto quieto.
 */
export function resumenDeViajes(viajes: Viaje[], desde: string | null, hasta: string | null, puntos: number) {
    return {
        km: Math.round(viajes.reduce((a, v) => a + v.km, 0) * 100) / 100,
        enMovimientoMin: viajes.reduce((a, v) => a + v.minutos, 0),
        velMax: viajes.reduce((a, v) => Math.max(a, v.velMax), 0),
        desde, hasta, puntos,
    };
}
