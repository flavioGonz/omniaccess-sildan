/**
 * Una lectura de la misma chapa que es el MISMO AUTO QUIETO, no una pasada nueva.
 *
 * 17/11, Nico: «las capturas repetidas de un auto estacionado frente a la cámara; cuando le doy
 * seguimiento muestra eso». Medido ese día en el lab: un VW gris parado frente a «LPR Salida»
 * dejó **327 eventos en 2 h 17** —el 44 % de todo lo que registró esa cámara en el día— y 2.588
 * avistamientos desde el 13/10.
 *
 * El antirrebote que ya había (por cámara + chapa, 20 s) no lo agarra: la cámara relee al auto
 * quieto **cada 20 a 45 s**, justo por afuera de la ventana. Y subir la ventana a ciegas taparía
 * una segunda pasada real.
 *
 * Lo que sí lo distingue es el recuadro de la chapa, que la cámara ya manda en el aviso
 * (`PlateRect`). Medido sobre esos mismos eventos:
 *
 *   · El auto quieto: `734/233` · `733/233` · `734/232` … se mueve **±1 px en dos horas**.
 *   · Los que pasaron: `317/444` → `467/516` → `272/450` … decenas o cientos de píxeles.
 *
 * Sobre 30 días y 52.484 eventos con recuadro, 6.699 (13 %) caen «en el mismo lugar» con ±8.
 *
 * Y hace falta la segunda condición, que no es obvia: entre dos lecturas «en el mismo lugar» la
 * mediana es de 28 s, pero el percentil 95 son **47 horas** — porque el mismo lugar también lo
 * ocupa el vecino que estaciona siempre ahí, dos días después. Sin la ventana de tiempo, una
 * visita de hoy se pegaría a la de anteayer.
 */

/**
 * Cuánto se puede mover el recuadro y seguir siendo el mismo auto quieto. Hikvision manda el
 * recuadro normalmente en 0-1000, así que 8 es el 0,8 % del cuadro: ocho veces lo medido (±1).
 */
const TOLERANCIA = 8;

/**
 * Cuánto puede pasar entre una lectura y la siguiente para que sigan siendo la misma parada.
 * La cámara relee cada 20-45 s, así que cinco minutos encadena con holgura; y es mucho menos que
 * el rato que tarda en volver el que estaciona siempre en el mismo lugar.
 */
const VENTANA_MS = 5 * 60 * 1000;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** El recuadro, si viene con los cuatro números. Sin recuadro no se puede decidir nada. */
function caja(r) {
    if (!r || typeof r !== "object") return null;
    const x = num(Number(r.x)), y = num(Number(r.y)), w = num(Number(r.w)), h = num(Number(r.h));
    return x == null || y == null || w == null || h == null ? null : { x, y, w, h };
}

/**
 * ¿Esta lectura es el mismo vehículo quieto que la anterior?
 *
 * Pide las dos cosas: que el recuadro no se haya movido y que la anterior sea reciente. Sin
 * recuadro —en una u otra— contesta `false`: se sigue por el camino de siempre (el antirrebote
 * de 20 s), que es lo que corresponde cuando no hay con qué distinguir.
 */
function esElMismoQuieto(anterior, actual, dtMs, tolerancia = TOLERANCIA, ventanaMs = VENTANA_MS) {
    const a = caja(anterior), b = caja(actual);
    if (!a || !b) return false;
    if (!(dtMs >= 0) || dtMs > ventanaMs) return false;
    return Math.abs(a.x - b.x) <= tolerancia && Math.abs(a.y - b.y) <= tolerancia;
}

module.exports = { TOLERANCIA, VENTANA_MS, caja, esElMismoQuieto };
