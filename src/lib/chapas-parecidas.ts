/**
 * ¿La chapa que se consulta puede ser otra, mal leída?
 *
 * Por qué existe (13/11, Nico: «es la primera vez que vemos eso… necesitamos saber por qué la da»).
 * El Ministerio contestó «está requerida» para SCH1707. La respuesta era del sitio, tal cual; pero
 * la chapa consultada salió de UNA lectura. En esa misma cámara, esa semana, el lector había leído
 * SDH1707 dieciocho veces, SDM1707 siete, y SCH1707 una sola: el auto estacionado es, casi seguro,
 * SDH1707, y la requerida es otro vehículo. Un cartel rojo de «matrícula requerida» sobre una
 * lectura equivocada es acusar al auto que no es.
 *
 * Acá sólo se decide cuáles otras chapas vale la pena mostrarle a quien consulta: las del mismo
 * largo que difieren en una o dos letras y que se leyeron MÁS veces. La decisión es de la persona,
 * mirando la foto. Sin base ni red: lo usan la ruta y las pruebas.
 */
export type ConteoChapa = { chapa: string; lecturas: number };

/** En cuántas posiciones difieren dos chapas del mismo largo (Infinity si el largo no coincide). */
export function diferencias(a: string, b: string): number {
    if (a.length !== b.length) return Infinity;
    let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
    return n;
}

/** Hasta cuántas letras de diferencia se toma como «puede ser la misma, mal leída». */
export const DIFERENCIAS_MAX = 2;
/** Cuántas se muestran. */
export const PARECIDAS_MAX = 3;

/** Las chapas parecidas a `chapa` que se leyeron más veces que ella, de la más leída a la menos. */
export function variantesMasLeidas(chapa: string, conteos: ConteoChapa[]): { propias: number; parecidas: ConteoChapa[] } {
    const propias = conteos.find((c) => c.chapa === chapa)?.lecturas ?? 0;
    const parecidas = conteos
        .filter((c) => c.chapa !== chapa && c.lecturas > propias && diferencias(c.chapa, chapa) <= DIFERENCIAS_MAX)
        .sort((a, b) => b.lecturas - a.lecturas || diferencias(a.chapa, chapa) - diferencias(b.chapa, chapa))
        .slice(0, PARECIDAS_MAX);
    return { propias, parecidas };
}
