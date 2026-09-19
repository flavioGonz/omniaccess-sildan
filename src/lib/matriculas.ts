/**
 * ¿Dos lecturas de la misma chapa, o de dos chapas distintas?
 *
 * El OCR no devuelve siempre lo mismo para la misma matrícula — ese es justamente el
 * motivo por el que las lecturas se votan. Comparar por texto exacto parte en dos al
 * mismo vehículo: en Calle 21 el mismo auto quedó como `DAF1168` a las 17:08:04 y como
 * `OAF1168` dos segundos después, y la foto ampliada confirma que dice OAF 1168.
 *
 * Hay DOS maneras de equivocarse, y piden reglas distintas:
 *
 *   Confusión de caracteres. Mismo largo, uno o dos caracteres cambiados: D por O, 8 por
 *   B, 1 por I. Se tolera por parecido. Dos vehículos distintos no coinciden en seis o
 *   siete posiciones, así que el riesgo de juntar dos autos de verdad es despreciable
 *   frente al de partir uno en dos.
 *
 *   Chapa cortada. La lectura devuelve un pedazo: `AAU90` donde dice `AAU9032`. Esto no
 *   es confusión, es recorte — lo produce el baldoseado cuando la chapa cae justo en el
 *   borde de una baldosa, y por definición cambia el largo, así que la comparación por
 *   parecido no lo agarra nunca. En Calle 22, el mismo auto estacionado abrió DOS
 *   estadías el mismo segundo por este motivo, y el panel lo mostraba como dos autos.
 *   Se resuelve aparte: si una lectura es el principio o el final de la otra y le faltan
 *   pocos caracteres, es la misma chapa cortada.
 *
 * La pasarela tiene su propia copia de esto (es otro proceso, en JS). Si cambia acá,
 * cambiar también `mismaChapa` en tracking-worker.js.
 */

/** Mínimo que tiene que quedar de una chapa cortada para poder reconocerla. */
const RECORTE_MIN = 5;
/** Cuántos caracteres puede haber perdido el recorte. Más que esto ya no es una chapa. */
const RECORTE_MAX = 3;

export function mismaChapa(a: string, b: string) {
    if (!a || !b) return false;
    if (a === b) return true;

    if (a.length === b.length) {
        const tolera = a.length >= 6 ? 2 : 1;
        let d = 0;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) { d++; if (d > tolera) return false; }
        }
        return true;
    }

    // Chapa cortada: la corta tiene que ser principio o final de la larga.
    const [corta, larga] = a.length < b.length ? [a, b] : [b, a];
    if (corta.length < RECORTE_MIN) return false;
    if (larga.length - corta.length > RECORTE_MAX) return false;
    return larga.startsWith(corta) || larga.endsWith(corta);
}

/**
 * ¿Tiene forma de matrícula, o es un invento del OCR?
 *
 * El lector devuelve texto aunque no haya una chapa: un cartel, el número de una casa, el
 * borde de una ventana. En Calle 22 entraron `1111` y `CWA111` como si fueran vehículos,
 * y una vez dentro abrían estadía y aparecían en el panel como autos estacionados.
 *
 * La matrícula uruguaya de particular es tres letras y cuatro números. No se exige ese
 * molde exacto a propósito — hay chapas viejas, de otro departamento, de moto y
 * extranjeras, y rechazarlas sería peor que dejar pasar algo de ruido. Lo que se exige es
 * lo mínimo que toda chapa cumple y el ruido no: largo razonable, y que tenga letras Y
 * números. `1111` no tiene letras; `CWA` no tiene números.
 */
export function pareceMatricula(p: string) {
    if (!p) return false;
    const s = p.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (s.length < 6 || s.length > 8) return false;
    if (!/[A-Z]/.test(s)) return false;
    if (!/[0-9]/.test(s)) return false;
    return true;
}
