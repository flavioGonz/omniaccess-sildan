/**
 * Dónde cae en el plano lo que una cámara ve en su cuadro.
 *
 * Una estadía sabe QUÉ CÁMARA ve el auto, no dónde está el auto: la fila guarda la
 * posición del equipo. Dibujar un ícono ahí diría "el auto está en este punto" cuando lo
 * cierto es "el auto está en algún lugar de lo que mira esta cámara", que pueden ser
 * treinta metros de calle.
 *
 * Pero el recuadro de la chapa sí dice dos cosas, y las dos son medidas, no supuestos:
 *
 *   DE QUÉ LADO. `x` es la posición horizontal en el cuadro, de 0 a 1. Si la cámara mira
 *   al noreste y abarca 80 grados, una chapa en x=0,2 está a la izquierda de esa escena y
 *   una en x=0,9 casi en el borde derecho. Eso es un ángulo real respecto del rumbo.
 *
 *   A QUÉ DISTANCIA, aproximada. El área de la chapa cae con el CUADRADO de la distancia:
 *   a la mitad de distancia se ve cuatro veces más grande. Comparando el área contra la
 *   típica de esa cámara —la misma mediana que usa el filtro de recuadros— sale un factor
 *   de distancia relativo sin necesidad de calibrar nada.
 *
 * Lo que sale de acá es una posición APROXIMADA y honesta: no es el punto exacto, pero
 * tampoco es inventado. Dos autos en la misma escena van a quedar en el orden correcto y
 * a distancias relativas correctas, que es lo que uno mira en un plano.
 *
 * Con la calibración completa —la homografía del cuadro al plano— esto se reemplaza por
 * la posición de verdad. Mientras tanto, esto no miente: el auto se dibuja siempre DENTRO
 * del cono de la cámara, y un cono es una afirmación que el sistema puede sostener.
 */

export type Caja = { x: number; y: number; w: number; h: number };

/** Cuántos grados abarca una cámara de calle, si nadie dijo otra cosa. */
export const ANGULO_POR_DEFECTO = 80;

/**
 * A qué distancia se dibuja un auto cuya chapa mide lo típico de esa cámara.
 *
 * Es el ancla de la escala: con el área típica, el auto cae a estos metros de la cámara.
 * No sale de medir el mundo —para eso hace falta la calibración— sino de que a esa
 * distancia el dibujo queda dentro de la manzana y se lee. Cambiarlo estira o encoge toda
 * la escena por igual, sin alterar el orden ni las proporciones entre autos.
 */
export const METROS_TIPICOS = 22;

/** Cuánto se permite estirar la escena, para que un recuadro raro no mande el auto al río. */
const METROS_MIN = 6;
const METROS_MAX = 60;

/**
 * Metros desde la cámara, a partir de cuánto ocupa la chapa.
 *
 * `area / tipica = (d_tipica / d)²`, así que `d = d_tipica / raíz(area / tipica)`.
 */
export function metrosDesdeArea(area: number, areaTipica: number | null): number {
    if (!areaTipica || area <= 0) return METROS_TIPICOS;
    const d = METROS_TIPICOS / Math.sqrt(area / areaTipica);
    return Math.min(METROS_MAX, Math.max(METROS_MIN, d));
}

/** Grados a sumar al rumbo de la cámara según de qué lado del cuadro cayó la chapa. */
export function desvioDesdeX(x: number, ancho: number, angulo: number): number {
    // El centro de la chapa, no su borde: una chapa ancha pegada al borde izquierdo tiene
    // su centro más adentro, y es el centro el que dice hacia dónde está el auto.
    const centro = Math.min(1, Math.max(0, x + ancho / 2));
    return (centro - 0.5) * angulo;
}

const R_TIERRA = 6_378_137;

/** Un punto a tantos metros y tantos grados de otro. 0 grados es el norte. */
export function correr(lat: number, lng: number, metros: number, rumbo: number): [number, number] {
    const rad = (rumbo * Math.PI) / 180;
    const dLat = (metros * Math.cos(rad)) / R_TIERRA;
    const dLng = (metros * Math.sin(rad)) / (R_TIERRA * Math.cos((lat * Math.PI) / 180));
    return [lat + (dLat * 180) / Math.PI, lng + (dLng * 180) / Math.PI];
}

/**
 * Dónde dibujar un auto que esta cámara ve parado.
 *
 * Sin recuadro o sin rumbo no se inventa nada: cae en el eje de la cámara, a la distancia
 * típica. Sigue estando dentro del cono, que es lo único que se puede afirmar.
 */
export function ubicarEnLaEscena(
    camara: { lat: number; lng: number; rumbo?: number | null; angulo?: number | null },
    caja: Caja | null,
    areaTipica: number | null,
): { lat: number; lng: number; metros: number; desvio: number } {
    const angulo = camara.angulo ?? ANGULO_POR_DEFECTO;
    const rumbo = camara.rumbo ?? 0;
    const metros = caja ? metrosDesdeArea(Math.abs(caja.w * caja.h), areaTipica) : METROS_TIPICOS;
    const desvio = caja ? desvioDesdeX(caja.x, caja.w, angulo) : 0;
    const [lat, lng] = correr(camara.lat, camara.lng, metros, rumbo + desvio);
    return { lat, lng, metros, desvio };
}

/** El triángulo de lo que mira la cámara, para dibujarlo en el plano. */
export function conoDeVision(
    camara: { lat: number; lng: number; rumbo?: number | null; angulo?: number | null },
    alcance = METROS_MAX,
): [number, number][] {
    const angulo = camara.angulo ?? ANGULO_POR_DEFECTO;
    const rumbo = camara.rumbo ?? 0;
    const puntos: [number, number][] = [[camara.lat, camara.lng]];
    // Un arco y no dos rectas: el borde de lo que se ve está a la misma distancia en todas
    // las direcciones, y con dos rectas las esquinas quedan más lejos que el centro.
    const PASOS = 12;
    for (let i = 0; i <= PASOS; i++) {
        puntos.push(correr(camara.lat, camara.lng, alcance, rumbo - angulo / 2 + (angulo * i) / PASOS));
    }
    return puntos;
}
