/**
 * La chapa de un vehículo quieto: la que más veces se leyó, no la de «mejor confianza».
 *
 * Por qué (13/11, Nico: «que pueda… entender cuando estacionó un auto, si puede registrar la
 * matrícula mejor»). Una estadía se relee con cada vehículo que pasa, y cada relectura puede
 * salir distinta. La fila se quedaba con la lectura de mayor confianza. Medido ese día en el lab,
 * en la cámara donde un mismo auto figuraba como SDH1707, SDM1707 y SCH1707: la confianza de
 * TODAS las lecturas tocaba el mismo techo (máxima 0,900 en las ocho variantes; medias de 0,87 a
 * 0,90). Con la confianza empatada, «la mejor» era en los hechos la primera que llegó al techo, y
 * las treinta y pico relecturas siguientes no contaban para nada.
 *
 * Ahora cada relectura es un voto. Gana la chapa con más lecturas; si empatan, la de más
 * confianza acumulada; si también empatan, queda la que ya estaba (no se cambia el nombre por un
 * empate). Es la misma idea que la votación entre cuadros de una ráfaga, llevada a lo largo de la
 * estadía.
 *
 * Lo que NO resuelve: si el lector se equivoca siempre igual (lee D donde hay C la mayoría de las
 * veces), la más leída es la equivocada. La votación dice cuál es la lectura más repetida, no
 * cuál es la verdad; por eso los votos se guardan enteros y se pueden mostrar.
 *
 * Sin base: lo usan la ruta de avistamientos, las ocupaciones y las pruebas.
 */
export type Votos = Record<string, { n: number; c: number }>;

/** Cuántas chapas distintas se recuerdan por estadía: las de menos votos se van cayendo. */
const VARIANTES_MAX = 12;

/** Lee lo guardado (JSON de la base); cualquier otra cosa es «sin votos». */
export function leerVotos(v: unknown): Votos | null {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const out: Votos = {};
    for (const [k, x] of Object.entries(v as Record<string, any>)) {
        const n = Number(x?.n), c = Number(x?.c);
        if (k && Number.isFinite(n) && n > 0) out[k] = { n, c: Number.isFinite(c) ? c : 0 };
    }
    return Object.keys(out).length ? out : null;
}

/**
 * Suma una lectura. `lecturas` es en cuántos cuadros de la ráfaga coincidió (una chapa vista en
 * cinco cuadros pesa cinco); `confianza`, la de esa lectura (0-1).
 */
export function votar(votos: Votos | null, chapa: string, lecturas?: number | null, confianza?: number | null): Votos {
    const n = Math.max(1, Math.round(Number(lecturas) || 1)), c = Math.max(0, Number(confianza) || 0) * n;
    const out: Votos = { ...(votos || {}) };
    out[chapa] = { n: (out[chapa]?.n || 0) + n, c: Math.round(((out[chapa]?.c || 0) + c) * 1000) / 1000 };
    const claves = Object.keys(out);
    if (claves.length > VARIANTES_MAX) {
        // Se cae la de menos votos que no sea la recién votada.
        const sobra = claves.filter((k) => k !== chapa).sort((a, b) => out[a].n - out[b].n || out[a].c - out[b].c)[0];
        delete out[sobra];
    }
    return out;
}

/** La chapa que gana. `actual` es la que tiene hoy la fila: la conserva ante un empate. */
export function ganadora(votos: Votos, actual: string): string {
    let mejor = votos[actual] ? actual : "";
    for (const k of Object.keys(votos)) {
        if (!mejor) { mejor = k; continue; }
        const a = votos[k], b = votos[mejor];
        if (a.n > b.n || (a.n === b.n && a.c > b.c)) mejor = k;
    }
    return mejor || actual;
}

/** Los votos con que arranca una fila que ya existía sin ellos: lo que se sabía de su chapa. */
export const votosIniciales = (chapa: string, lecturas?: number | null, confianza?: number | null): Votos => votar(null, chapa, lecturas, confianza);
