/**
 * Identidad por rostro: a quién pertenece una cara que acaba de pasar (13/11, Nico: «el modo face
 * debe guardar el rostro detectado y asignarle un id, compararlo para saber cuántas veces pasa,
 * poder registrarlo»).
 *
 * Hasta acá el modo face sólo sabía decir «es Fulano, del padrón» o «Desconocido». Un desconocido
 * que pasa veinte veces eran veinte desconocidos. Ahora cada cara nítida que no se parece a nadie
 * funda una identidad (un Rostro, «R-0042»), y las siguientes veces que aparece se le suman.
 *
 * Este archivo decide; no habla con la base ni con el motor (eso es vision-rostros.js). Sin
 * dependencias: lo usan vision-worker y los tests.
 *
 * ── Lo medido antes de escribirlo (lab, 13/11, las 45 caras de la semana que seguían en el bucket) ──
 *
 *   · El motor miraba el cuadro chico (640×360). Ahí la cara mide 14 a 20 px en 30 de las 45
 *     (todas de «puesto 7 cam 2»): ninguna sirvió para comparar, el motor no acepta ni una como
 *     cara al enrolarla. Por eso ahora se mira el cuadro del stream principal (vision-rostros).
 *   · De 60 px para arriba enroló 13 de 15.
 *   · Una cara mala se parece a cualquiera: un recorte pixelado de 68 px (detección 0,79) dio 0,82
 *     contra otra persona. Entre caras buenas de personas distintas, lo más alto fue 0,58 (y 0,66
 *     en la medición del 8/11). La única pareja que parece la misma persona en dos días dio 0,70.
 *
 * Con esos números NO hay un umbral que separe solo: 0,70 de un acierto queda cerca de 0,66 de un
 * impostor. De ahí las dos decisiones de abajo: una compuerta de calidad antes de comparar, y dos
 * umbrales en vez de uno (arriba se suma sola; en el medio se propone y decide una persona).
 * Los valores son provisorios: cada pasada guarda su similitud, para volver a medir con caras del
 * stream principal.
 */

/** Alto mínimo de la cara, en px del cuadro que se le dio al motor, para fundar o sumar a una identidad. */
const CARA_PX_MIN = 80;
/** Confianza mínima de que eso es una cara. Por debajo, el recorte suele ser una mancha que se parece a todos. */
const CARA_PROB_MIN = 0.9;
/** De acá para arriba es la misma persona y la pasada se suma sola. Setting FACE_UMBRAL_MISMA. */
const UMBRAL_MISMA = 0.8;
/** Entre éste y el de arriba, se parece: nace una identidad nueva con la sugerencia de unirla. Setting FACE_UMBRAL_PARECIDA. */
const UMBRAL_PARECIDA = 0.65;
/** Verse de nuevo antes de esto es la misma visita (cruzó dos cámaras, o la pista se cortó y siguió). */
const VISITA_MS = 10 * 60_000;
/** Cuántas caras de una misma identidad se le dan al motor: más ángulos, mejor la reconoce; sin tope crecería sin fin. */
const EJEMPLOS_MAX = 5;
/** Una cara tiene que ser tanto mejor que la guardada para reemplazarla como foto de la identidad. */
const MEJORA_FOTO = 1.15;
/** Días sin verla tras los que se olvida una identidad que nadie registró. Setting FACE_ANONIMOS_DIAS. */
const ANONIMOS_DIAS = 30;
/** El prefijo del sujeto en el motor para una identidad nacida sola. Los del padrón llevan el nombre de la persona. */
const PREFIJO = "rostro-";

const sujetoDe = (id) => PREFIJO + id;
const idDeSujeto = (sujeto) => (typeof sujeto === "string" && sujeto.startsWith(PREFIJO) ? sujeto.slice(PREFIJO.length) : null);
/** «R-0042»: cómo se nombra en pantalla a quien todavía no tiene nombre. */
const codigo = (numero) => "R-" + String(Math.max(0, Math.trunc(Number(numero) || 0))).padStart(4, "0");

const numero = (v, def, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : def; };
/** Los umbrales con los Settings aplicados (texto o null) y dentro de rangos que tengan sentido. */
function umbrales(aj = {}) {
    const misma = numero(aj.misma, UMBRAL_MISMA, 0.5, 0.99);
    // «Parecida» nunca por encima de «misma»: si no, el medio no existe y nada se sugiere.
    const parecida = Math.min(numero(aj.parecida, UMBRAL_PARECIDA, 0.3, 0.99), misma);
    return { misma, parecida, padron: numero(aj.padron, 0.89, 0.5, 0.99), pxMin: numero(aj.pxMin, CARA_PX_MIN, 30, 600), probMin: CARA_PROB_MIN };
}

/**
 * Qué se hace con una cara.
 *
 *   cara: { px, prob }                    lo que midió el motor al detectarla
 *   vecinos: [{ sujeto, similitud }]      a quién se parece, de más a menos
 *
 * Devuelve `que`:
 *   "padron"    → es alguien enrolado a mano (sujeto = su nombre) por encima del umbral del padrón.
 *   "misma"     → es una identidad ya vista: la pasada se le suma.
 *   "nueva"     → nadie conocido: nace una identidad. Con `parecidaA` si se acercó a alguna.
 *   "sin-cara"  → la cara no da para comparar: la pasada queda sin identidad, y dice por qué.
 */
function decidir(cara, vecinos, u = umbrales()) {
    const px = Math.round(Number(cara?.px) || 0), prob = Number(cara?.prob) || 0;
    const top = (vecinos || [])[0] || null;
    const sim = top ? Number(top.similitud) || 0 : 0;
    const idTop = top ? idDeSujeto(top.sujeto) : null;
    // El padrón va antes que la compuerta: es lo que ya andaba (un acceso reconocido), con su propio umbral alto.
    if (top && !idTop && sim >= u.padron) return { que: "padron", sujeto: top.sujeto, similitud: sim };
    if (px < u.pxMin) return { que: "sin-cara", motivo: `cara chica (${px} px)` };
    if (prob < u.probMin) return { que: "sin-cara", motivo: `cara dudosa (${Math.round(prob * 100)} %)` };
    if (top && idTop && sim >= u.misma) return { que: "misma", rostroId: idTop, similitud: sim };
    const cerca = top && sim >= u.parecida ? { parecidaA: top.sujeto, parecido: sim } : {};
    return { que: "nueva", ...cerca };
}

/** ¿Esta vez que se la ve es otra visita, o la misma que venía? */
const esOtraVisita = (ultimaVez, ahora) => !ultimaVez || new Date(ahora).getTime() - new Date(ultimaVez).getTime() > VISITA_MS;

/** ¿Vale la pena darle esta cara al motor como otro ejemplo de la misma identidad? */
const sumaEjemplo = (ejemplos, similitud) => ejemplos < EJEMPLOS_MAX && similitud < 0.97;

/** ¿Esta cara es mejor foto que la guardada? */
const esMejorFoto = (pxNueva, pxGuardada) => pxNueva >= (Number(pxGuardada) || 0) * MEJORA_FOTO;

module.exports = {
    CARA_PX_MIN, CARA_PROB_MIN, UMBRAL_MISMA, UMBRAL_PARECIDA, VISITA_MS, EJEMPLOS_MAX, MEJORA_FOTO, ANONIMOS_DIAS, PREFIJO,
    sujetoDe, idDeSujeto, codigo, umbrales, decidir, esOtraVisita, sumaEjemplo, esMejorFoto,
};
