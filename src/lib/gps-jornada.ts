import { metrosEntre } from "@/lib/gps-recorrido";
import { PARADA_MIN_MS, type Viaje } from "@/lib/gps-viajes";

/**
 * Leer un recorrido: la jornada (viaje · estacionado · viaje…), la velocidad a lo largo de la
 * línea y dónde se pasó del límite.
 *
 * Pedido de Nico (22/11): «identificar claramente los viajes y el tiempo de estacionado; en las
 * líneas de trayectoria conocer la velocidad reportada, y animar la parte que excede la velocidad
 * permitida por la empresa; un control para desplazar el auto sobre el trayecto y conocer el
 * tiempo exacto en que pasó por cada punto y los datos reportados».
 *
 * Todo lo de acá es cuenta pura sobre los puntos que ya trae el recorrido: se prueba sin mapa.
 */

export type PuntoDeRuta = { lat: number; lon: number; cuando: string; velocidad: number; rumbo?: number | null; sat?: number | null; enc?: boolean | null };

/* ---------- La jornada ---------- */

export type Tramo =
    | { tipo: "viaje"; n: number; viaje: Viaje }
    | { tipo: "estacionado"; desde: string; hasta: string; minutos: number; lat: number; lon: number; /** Sigue ahí: el tramo termina «ahora», no en otro viaje. */ sigue: boolean };

/**
 * La jornada en orden: cada viaje y, entre uno y otro, cuánto estuvo estacionado y dónde.
 *
 * Los viajes solos no cuentan el día: «salió a las 8:10 y a las 17:40» no dice que entre medio
 * estuvo nueve horas parado en un mismo lugar, que suele ser lo que se quiere saber. Por eso el
 * estacionado es un renglón con su propio reloj, y hay dos que los viajes no traen:
 *  · el de ANTES del primer viaje (desde que empieza el período), y
 *  · el de DESPUÉS del último, que si el período llega hasta ahora sigue corriendo.
 * Un rato quieto más corto que una parada (un semáforo largo) no figura.
 */
export function jornadaDe(viajes: Viaje[], periodo: { desde: string | null; hasta: string | null; hastaAhora?: boolean }): Tramo[] {
    const j: Tramo[] = [];
    const quieto = (desde: string, hasta: string, lat: number, lon: number, sigue = false) => {
        const minutos = Math.round((new Date(hasta).getTime() - new Date(desde).getTime()) / 60_000);
        if (minutos * 60_000 >= PARADA_MIN_MS) j.push({ tipo: "estacionado", desde, hasta, minutos, lat, lon, sigue });
    };
    viajes.forEach((v, i) => {
        if (i === 0) { if (periodo.desde) quieto(periodo.desde, v.desde, v.inicio.lat, v.inicio.lon); }
        else quieto(viajes[i - 1].hasta, v.desde, viajes[i - 1].fin.lat, viajes[i - 1].fin.lon);
        j.push({ tipo: "viaje", n: i + 1, viaje: v });
    });
    const ultimo = viajes[viajes.length - 1];
    if (ultimo && periodo.hasta) quieto(ultimo.hasta, periodo.hasta, ultimo.fin.lat, ultimo.fin.lon, !!periodo.hastaAhora);
    return j;
}

/** Cuánto tiempo estuvo estacionado en total en la jornada, en minutos. */
export const minutosEstacionado = (j: Tramo[]): number => j.reduce((a, t) => a + (t.tipo === "estacionado" ? t.minutos : 0), 0);

/* ---------- La velocidad sobre la línea ---------- */

/** El límite de la empresa si nadie cargó otro: la máxima de ruta en Uruguay. */
export const LIMITE_DEFECTO = 90;
export const leerLimite = (v: unknown): number => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 20 && n <= 200 ? n : LIMITE_DEFECTO; };

/**
 * En qué franja cae una velocidad respecto del límite. Cuatro, no un degradé: lo que hay que ver
 * de un vistazo es «despacio, normal, al borde, pasado», no distinguir 61 de 64 km/h por el matiz.
 */
export type Franja = "lento" | "normal" | "borde" | "exceso";
export function franjaDe(velocidad: number, limite: number): Franja {
    if (velocidad > limite) return "exceso";
    if (velocidad > limite * 0.85) return "borde";
    return velocidad > limite * 0.4 ? "normal" : "lento";
}
export const COLOR_FRANJA: Record<Franja, string> = { lento: "#38bdf8", normal: "#34d399", borde: "#fbbf24", exceso: "#ef4444" };

/**
 * La línea de un viaje, cortada en trozos de una misma franja. Cada trozo empieza en el último
 * punto del anterior: si no, entre dos colores quedaría un hueco del largo de un reporte.
 * El color de un trozo es el de la velocidad con que se LLEGÓ a cada punto.
 */
export function trozosPorVelocidad(p: PuntoDeRuta[], limite: number): { franja: Franja; linea: [number, number][] }[] {
    const trozos: { franja: Franja; linea: [number, number][] }[] = [];
    for (let i = 1; i < p.length; i++) {
        const f = franjaDe(p[i].velocidad, limite), ult = trozos[trozos.length - 1];
        if (ult && ult.franja === f) ult.linea.push([p[i].lat, p[i].lon]);
        else trozos.push({ franja: f, linea: [[p[i - 1].lat, p[i - 1].lon], [p[i].lat, p[i].lon]] });
    }
    return trozos;
}

/* ---------- Los excesos ---------- */

export type Exceso = {
    /** Entre qué puntos del recorrido (índices, los dos incluidos). */
    i0: number; i1: number;
    desde: string; hasta: string; segundos: number; velMax: number; metros: number;
};

/** Dos reportes pasados del límite separados por más de esto no son el mismo exceso. */
const EXCESO_HUECO_MS = 60_000;

/**
 * Los tramos en que anduvo por encima del límite.
 *
 * Un exceso es una racha de reportes seguidos pasados del límite. Un solo reporte alcanza —el
 * equipo reporta cada diez segundos: uno pasado son diez segundos pasado—, pero dos reportes
 * separados por un hueco largo no se unen: en el medio no se sabe a cuánto iba. La duración se
 * cuenta desde el reporte anterior al primero pasado (ahí empezó a acelerar), si está cerca.
 */
export function excesosDe(p: PuntoDeRuta[], limite: number): Exceso[] {
    const ex: Exceso[] = [];
    const t = (i: number) => new Date(p[i].cuando).getTime();
    let i0 = -1;
    const cerrar = (i1: number) => {
        const desde = i0 > 0 && t(i0) - t(i0 - 1) <= EXCESO_HUECO_MS ? i0 - 1 : i0;
        let metros = 0, velMax = 0;
        for (let k = desde + 1; k <= i1; k++) metros += metrosEntre(p[k - 1], p[k]);
        for (let k = i0; k <= i1; k++) velMax = Math.max(velMax, p[k].velocidad);
        ex.push({ i0: desde, i1, desde: p[desde].cuando, hasta: p[i1].cuando, segundos: Math.max(10, Math.round((t(i1) - t(desde)) / 1000)), velMax, metros: Math.round(metros) });
        i0 = -1;
    };
    for (let i = 0; i < p.length; i++) {
        const pasado = p[i].velocidad > limite;
        if (i0 >= 0 && (!pasado || t(i) - t(i - 1) > EXCESO_HUECO_MS)) cerrar(i - 1);
        if (pasado && i0 < 0) i0 = i;
    }
    if (i0 >= 0) cerrar(p.length - 1);
    return ex;
}

export function resumenDeExcesos(ex: Exceso[]): { veces: number; segundos: number; velMax: number; metros: number } {
    return { veces: ex.length, segundos: ex.reduce((a, e) => a + e.segundos, 0), velMax: ex.reduce((a, e) => Math.max(a, e.velMax), 0), metros: ex.reduce((a, e) => a + e.metros, 0) };
}

/* ---------- Recorrerlo ---------- */

/** El punto del recorrido más cercano a donde se tocó la línea. */
export function puntoMasCercano(p: PuntoDeRuta[], lat: number, lon: number): number {
    let mejor = -1, d = Infinity;
    for (let i = 0; i < p.length; i++) { const x = (p[i].lat - lat) ** 2 + ((p[i].lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2; if (x < d) { d = x; mejor = i; } }
    return mejor;
}

const VIENTOS = ["norte", "noreste", "este", "sureste", "sur", "suroeste", "oeste", "noroeste"];
/** «hacia el noreste». Null si no hay rumbo. */
export const rumboEnPalabras = (grados: number | null | undefined): string | null => (grados == null || !Number.isFinite(grados) ? null : VIENTOS[Math.round((((grados % 360) + 360) % 360) / 45) % 8]);

/** «2 h 15 min», «45 min», «3 días 4 h». */
export function duracionLarga(min: number): string {
    if (min < 60) return `${min} min`;
    if (min < 1440) { const h = Math.floor(min / 60), m = min % 60; return m ? `${h} h ${m} min` : `${h} h`; }
    const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60); return h ? `${d} ${d === 1 ? "día" : "días"} ${h} h` : `${d} ${d === 1 ? "día" : "días"}`;
}
