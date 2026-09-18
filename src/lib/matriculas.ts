/**
 * ¿Dos lecturas de la misma chapa, o de dos chapas distintas?
 *
 * El OCR no devuelve siempre lo mismo para la misma matrícula — ese es justamente el
 * motivo por el que las lecturas se votan. Comparar por texto exacto parte en dos al
 * mismo vehículo: en Calle 21 el mismo auto quedó como `DAF1168` a las 17:08:04 y como
 * `OAF1168` dos segundos después, y la foto ampliada confirma que dice OAF 1168.
 *
 * Se compara por parecido: mismo largo y pocos caracteres de diferencia. Dos vehículos
 * distintos no coinciden en seis o siete posiciones, así que el riesgo de juntar dos
 * autos de verdad es despreciable frente al de partir uno en dos.
 *
 * La pasarela tiene su propia copia de esto (es otro proceso, en JS). Si cambia acá,
 * cambiar también `mismaChapa` en tracking-worker.js.
 */
export function mismaChapa(a: string, b: string) {
    if (!a || !b || a.length !== b.length) return false;
    if (a === b) return true;
    const tolera = a.length >= 6 ? 2 : 1;
    let d = 0;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) { d++; if (d > tolera) return false; }
    }
    return true;
}
