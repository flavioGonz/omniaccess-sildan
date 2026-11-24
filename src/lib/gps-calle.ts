import { metrosEntre } from "@/lib/gps-recorrido";

/**
 * Por qué calle fue: pasar las posiciones de un viaje —una cada diez o cuarenta segundos— al camino
 * por la calle que las une (24/11). Sin red ni base, para probarlo: acá se arma la pregunta para el
 * servicio de rutas y se lee su respuesta; preguntar es de `lib/rutas`.
 *
 * Nico, mirando el trayecto de un auto en el mapa: «no está bien alineado con las calles». Medido
 * ese día: el equipo mandaba una posición cada 40 s, y en 20 de 71 tramos el mapa unía con una
 * recta dos puntos separados por 150 a 300 m de manzanas.
 *
 * ── Qué se le cree al servicio y qué no ─────────────────────────────────────
 *
 * El servicio (OSRM) siempre contesta ALGO: si un punto cayó cerca de dos calles elige una, y si
 * eligió mal, para unirlo con el siguiente da la vuelta a la manzana. Dibujar eso es peor que la
 * recta: la recta se ve que es una aproximación; una vuelta inventada parece un dato. Por eso cada
 * tramo se acepta sólo si es creíble (`tramoCreible`), y el que no, queda como estaba: en recta.
 *
 * Medido con los recorridos reales del lab (24/11): con 25 m de radio queda sin calle el 3,5 % de
 * los puntos de un equipo que reporta cada 40 s y el 1,6 % de uno que reporta cada 10 s; con 10 m,
 * el 11 % y el 3,2 %; con 40 m no mejora y aparecen corrimientos de más de 100 m.
 */

/**
 * Con cuánto error del GPS cuenta el servicio al buscar la calle de cada punto. No es un tope: busca
 * hasta unas tres veces esto (con 25 se midieron corrimientos de hasta 69 m).
 */
export const RADIO_M = 25;
/**
 * El tope de verdad: a un punto no se lo corre más que esto para ponerlo sobre una calle. Más lejos
 * ya es otra calle —la paralela, o la de la mano de enfrente de una avenida ancha— y se lo deja
 * donde el GPS dijo. Medido el 24/11 con 25 m de radio: nueve de cada diez puntos se corren menos
 * de 9 m en un equipo que reporta cada 10 s y menos de 32 m en uno que reporta cada 40 s.
 */
export const CORRIMIENTO_MAX_M = 45;
/** Puntos por pregunta. El servicio acepta más; con cien la dirección de la pregunta queda corta y cada una tarda unos 10 ms. */
export const PUNTOS_POR_PEDIDO = 100;
/**
 * Cuánto más largo que la recta puede ser el camino entre dos posiciones seguidas. Doblando una
 * esquina es 1,41; rodeando una manzana entera para llegar a la calle de al lado, más de 3.
 */
export const RODEO_MAX = 2.6;
/** Margen fijo sobre el rodeo: entre dos puntos casi encimados cualquier camino es «mucho más largo». */
export const RODEO_MARGEN_M = 40;
/** A más de esto no anduvo: 180 km/h. Un camino que lo exigiría es de otra calle. */
export const VELOCIDAD_TOPE_MS = 50;
/**
 * Entre dos posiciones separadas por más de esto no se dibuja un camino: en dos minutos sin noticias
 * (un túnel, un estacionamiento techado, el equipo sin señal) el servicio daría el más corto, y por
 * dónde fue de verdad no se sabe. La recta lo dice; un camino dibujado lo afirmaría.
 */
export const SILENCIO_MAX_S = 120;
/** Un punto del camino que se aparta menos que esto de la línea entre sus vecinos no dibuja nada: se saca. */
const COLINEAL_M = 1.5;

export type PuntoCrudo = { lat: number; lon: number; cuando: string; velocidad?: number | null };
/** Lo que se sabe de un punto después de preguntar: dónde cae sobre la calle, y el camino desde el punto anterior. */
export type Ajuste = {
    /** El punto, puesto sobre la calle. Null si no hay una calle cerca. */
    enCalle: [number, number] | null;
    /** El camino por la calle desde el punto anterior hasta éste, SIN los dos extremos. Null: va en recta. */
    via: [number, number][] | null;
    /** Los metros de ese camino (con los extremos). Null si va en recta. */
    metros: number | null;
};

/** Las preguntas para un viaje: de a cien puntos, y cada tanda arranca en el último punto de la anterior para que no quede un tramo sin preguntar. */
export function pedidosDeAjuste(puntos: PuntoCrudo[]): { desde: number; hasta: number; ruta: string }[] {
    const pedidos: { desde: number; hasta: number; ruta: string }[] = [];
    for (let i = 0; i < puntos.length - 1; i += PUNTOS_POR_PEDIDO - 1) {
        const c = puntos.slice(i, i + PUNTOS_POR_PEDIDO);
        /* La hora de cada punto, en segundos y siempre creciente: dos posiciones en el mismo segundo hacen que el servicio rechace la pregunta entera. */
        const ts: number[] = [];
        for (const p of c) { const t = Math.floor(Date.parse(p.cuando) / 1000); ts.push(ts.length && t <= ts[ts.length - 1] ? ts[ts.length - 1] + 1 : t); }
        pedidos.push({
            desde: i, hasta: i + c.length - 1,
            /* `gaps=ignore`: el viaje ya viene cortado por nosotros; que el servicio no lo vuelva a partir porque un equipo reporta cada 40 s.
               `tidy=false`: una respuesta por punto, en el mismo orden. `steps`: el dibujo del camino tramo por tramo. */
            ruta: `/match/v1/driving/${c.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(";")}?timestamps=${ts.join(";")}&radiuses=${c.map(() => RADIO_M).join(";")}&steps=true&geometries=geojson&overview=false&tidy=false&gaps=ignore`,
        });
    }
    return pedidos;
}

/** Lo que interesa de la respuesta del servicio. */
export type RespuestaOsrm = {
    code?: string;
    tracepoints?: ({ location: [number, number]; matchings_index: number; waypoint_index: number } | null)[];
    matchings?: { confidence?: number; legs?: { distance: number; steps?: { geometry?: { coordinates?: [number, number][] } }[] }[] }[];
};

/**
 * ¿Se le cree a este tramo? `metros` es el camino por la calle, `recta` la distancia entre las dos
 * posiciones y `segundos` lo que pasó entre una y otra.
 */
export function tramoCreible(metros: number, recta: number, segundos: number): boolean {
    if (!(metros >= 0) || !Number.isFinite(metros)) return false;
    if (!(segundos > 0) || segundos > SILENCIO_MAX_S) return false;
    if (metros > recta * RODEO_MAX + RODEO_MARGEN_M) return false;
    if (metros > Math.max(1, segundos) * VELOCIDAD_TOPE_MS + RODEO_MARGEN_M) return false;
    return true;
}

/** A cuántos metros queda `p` de la línea que une `a` con `b` (a esta escala, la Tierra es plana). */
function apartado(p: [number, number], a: [number, number], b: [number, number]): number {
    const k = 111_320, c = Math.cos((a[0] * Math.PI) / 180);
    const ax = a[1] * k * c, ay = a[0] * k, bx = b[1] * k * c, by = b[0] * k, px = p[1] * k * c, py = p[0] * k;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    if (!l2) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
/**
 * El mismo camino sin los puntos que no dibujan nada: se queda con los que se apartan de la línea
 * entre los que ya quedaron (Douglas-Peucker). Mirar sólo los vecinos no alcanza: en una curva
 * suave cada punto está casi en línea con los dos de al lado, y se irían todos. Los extremos quedan siempre.
 */
export function sinColineales(camino: [number, number][]): [number, number][] {
    if (camino.length < 3) return camino;
    const queda = new Array<boolean>(camino.length).fill(false);
    queda[0] = queda[camino.length - 1] = true;
    const pila: [number, number][] = [[0, camino.length - 1]];
    while (pila.length) {
        const [a, b] = pila.pop()!;
        let peor = 0, cual = -1;
        for (let k = a + 1; k < b; k++) { const d = apartado(camino[k], camino[a], camino[b]); if (d > peor) { peor = d; cual = k; } }
        if (cual > 0 && peor > COLINEAL_M) { queda[cual] = true; pila.push([a, cual], [cual, b]); }
    }
    return camino.filter((_, k) => queda[k]);
}

/**
 * Lee la respuesta a una pregunta y deja, para cada punto de esa tanda, su ajuste. `puntos` son los
 * de la tanda, en el mismo orden en que se preguntaron. Si la respuesta no sirve, todos en recta.
 */
export function leerAjuste(puntos: PuntoCrudo[], r: RespuestaOsrm | null | undefined): Ajuste[] {
    const sinNada = (): Ajuste => ({ enCalle: null, via: null, metros: null });
    const tp = r?.tracepoints;
    if (!r || r.code !== "Ok" || !Array.isArray(tp) || tp.length !== puntos.length) return puntos.map(sinNada);
    /* Dónde quedó cada punto sobre la calle; el que se corrió demasiado se deja donde estaba. */
    const sobre = puntos.map((p, i): [number, number] | null => {
        const t = tp[i]; if (!t) return null;
        const ll: [number, number] = [t.location[1], t.location[0]];
        return metrosEntre(p, { lat: ll[0], lon: ll[1] }) <= CORRIMIENTO_MAX_M ? ll : null;
    });
    const salida: Ajuste[] = puntos.map((_, i) => ({ ...sinNada(), enCalle: sobre[i] }));
    for (let i = 1; i < puntos.length; i++) {
        const a = sobre[i - 1] ? tp[i - 1] : null, b = sobre[i] ? tp[i] : null;
        /* Los dos sobre la calle, en el mismo camino y uno detrás del otro: si no, entre ellos no hay un tramo que leer. */
        if (!a || !b || a.matchings_index !== b.matchings_index || b.waypoint_index !== a.waypoint_index + 1) continue;
        const tramo = r.matchings?.[a.matchings_index]?.legs?.[a.waypoint_index];
        if (!tramo) continue;
        const recta = metrosEntre(puntos[i - 1], puntos[i]), segundos = (Date.parse(puntos[i].cuando) - Date.parse(puntos[i - 1].cuando)) / 1000;
        if (!tramoCreible(tramo.distance, recta, segundos)) continue;
        const camino: [number, number][] = [];
        for (const paso of tramo.steps || []) for (const c of paso.geometry?.coordinates || []) {
            const ll: [number, number] = [c[1], c[0]], ult = camino[camino.length - 1];
            if (!ult || ult[0] !== ll[0] || ult[1] !== ll[1]) camino.push(ll);
        }
        /* Los extremos del camino son los dos puntos ya puestos sobre la calle: no se repiten. Y de lo
           del medio, sólo lo que dobla: una cuadra derecha trae un punto por esquina y ninguno dibuja nada. */
        salida[i].via = sinColineales([sobre[i - 1]!, ...camino.slice(1, -1), sobre[i]!]).slice(1, -1);
        salida[i].metros = tramo.distance;
    }
    return salida;
}

/**
 * Los ajustes de un viaje entero, juntando las tandas. El punto donde dos tandas se tocan se
 * preguntó dos veces: vale dónde lo puso la primera, y el camino hacia el siguiente lo da la segunda.
 */
export function juntarAjustes(cuantos: number, tandas: { desde: number; ajustes: Ajuste[] }[]): Ajuste[] {
    const todos: Ajuste[] = Array.from({ length: cuantos }, () => ({ enCalle: null, via: null, metros: null }));
    for (const t of tandas) t.ajustes.forEach((a, k) => {
        const i = t.desde + k; if (i >= cuantos) return;
        if (k === 0 && t.desde > 0) { if (!todos[i].enCalle) todos[i].enCalle = a.enCalle; return; }
        todos[i] = a;
    });
    return todos;
}

/**
 * El viaje, por la calle: cada punto sobre su calle y, entre punto y punto, los del camino.
 *
 * Los del camino se agregan como puntos (`via: true`) con la hora y la velocidad que les toca por
 * dónde están entre los dos puntos de verdad. Así todo lo que ya sabe andar sobre una lista de
 * puntos —la línea pintada por velocidad, el auto que reproduce el recorrido, la huella— va por la
 * calle sin enterarse. Lo que cuenta posiciones o las muestra una por una los saltea por la marca.
 */
export function porLaCalle<T extends PuntoCrudo>(puntos: T[], ajustes: Ajuste[]): (T & { via?: true })[] {
    const salida: (T & { via?: true })[] = [];
    puntos.forEach((p, i) => {
        const a = ajustes[i];
        const aca: [number, number] = a?.enCalle || [p.lat, p.lon];
        if (i > 0 && a?.via?.length) {
            const antes = salida[salida.length - 1], t0 = Date.parse(antes.cuando), t1 = Date.parse(p.cuando), v0 = antes.velocidad ?? 0, v1 = p.velocidad ?? 0;
            /* Cuánto del tramo lleva recorrido cada punto del camino: de ahí su hora y su velocidad. */
            const tramo: [number, number][] = [[antes.lat, antes.lon], ...a.via, aca];
            const acum = [0]; for (let k = 1; k < tramo.length; k++) acum.push(acum[k - 1] + metrosEntre({ lat: tramo[k - 1][0], lon: tramo[k - 1][1] }, { lat: tramo[k][0], lon: tramo[k][1] }));
            const total = acum[acum.length - 1] || 1;
            a.via.forEach((ll, k) => {
                const f = acum[k + 1] / total;
                /* Lo demás (satélites, contacto, rumbo) es lo del punto de verdad al que va: no tiene uno propio. */
                salida.push({ ...p, lat: ll[0], lon: ll[1], cuando: new Date(t0 + (t1 - t0) * f).toISOString(), velocidad: Math.round(v0 + (v1 - v0) * f), via: true });
            });
        }
        salida.push({ ...p, lat: aca[0], lon: aca[1] });
    });
    return salida;
}

/** Cuánto se pudo poner sobre la calle, para decirlo y para medirlo. */
export function resumenDeAjuste(puntos: PuntoCrudo[], ajustes: Ajuste[]): { tramos: number; porCalle: number; sinCalle: number; metrosRecta: number; metrosCalle: number } {
    let porCalle = 0, sinCalle = 0, metrosRecta = 0, metrosCalle = 0;
    for (let i = 1; i < puntos.length; i++) {
        const recta = metrosEntre(puntos[i - 1], puntos[i]);
        metrosRecta += recta;
        if (ajustes[i]?.via) { porCalle++; metrosCalle += ajustes[i].metros ?? recta; } else { sinCalle++; metrosCalle += recta; }
    }
    return { tramos: Math.max(0, puntos.length - 1), porCalle, sinCalle, metrosRecta: Math.round(metrosRecta), metrosCalle: Math.round(metrosCalle) };
}
