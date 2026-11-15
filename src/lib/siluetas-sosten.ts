/**
 * Que una silueta no parpadee: entra con confianza alta y se sostiene con menos.
 *
 * Por qué (15/11, Nico, con la entrada de proveedores llena de autos y de gente: «veo que no
 * agarra bien toda la escena»). Medido ese día sobre ese canal, 64 cuadros seguidos (8 s):
 *
 *  · El detector no veía menos por ir apurado: en una escena llena, muchos objetos (los del fondo,
 *    los medio tapados) andan con confianza entre 0,25 y 0,50, y el corte fijo en 0,40 los prendía
 *    y los apagaba cuadro por medio. En 8 s aparecieron 40 objetos y se fueron 31; 18 de esos
 *    duraron uno o dos cuadros.
 *  · Bajar el corte a 0,30 mostraba más (11,8 por cuadro contra 10,0) pero parpadeaba PEOR
 *    (64 apariciones): el problema no es el número, es que sea uno solo.
 *  · Con dos cortes —entra con 0,40, sigue mientras no baje de 0,25— y un instante de gracia
 *    cuando falta en un cuadro: 11,9 por cuadro, 21 apariciones, y sólo 2 de vida corta. Más
 *    objetos en pantalla y la mitad del parpadeo, sin pedirle nada más a la GPU (el análisis
 *    tarda lo mismo con el corte en 0,20 que en 0,40: 52 ms).
 *
 * Analizar el cuadro más grande no sirve (a 1440 px ve lo mismo que a 960: el modelo mira a su
 * propio tamaño) y partirlo en baldosas da casi lo mismo que esto a 3-7 veces el costo.
 *
 * Sólo para lo de fábrica (personas, vehículos, animales). Lo del detector entrenado tiene su
 * umbral de pantalla por clase, elegido a mano en Entrenar › Objetos: no se toca.
 *
 * Sin base ni red: lo usan la ruta de siluetas y las pruebas.
 */

/** Con cuánto ENTRA un objeto nuevo: el umbral de fábrica de omni-vision. */
export const CONFIANZA_ENTRA = 0.4;
/** Con cuánto SIGUE uno que ya estaba. Es también lo que se le pide a omni-vision. */
export const CONFIANZA_SIGUE = 0.25;
/** Cuánto se sostiene uno que faltó en un cuadro (dos cuadros a 8 por segundo). Más se nota como una silueta que queda atrás. */
export const GRACIA_MS = 280;
/** Cuánto se tienen que pisar dos cajas de cuadros seguidos para ser el mismo objeto. */
const MISMO_IOU = 0.3;

type ConCaja = { grupo: string; confianza: number; caja: number[] };

function iou(a: number[], b: number[]): number {
    const i = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i;
    return u > 0 ? i / u : 0;
}

/**
 * Una memoria por canal abierto. Se le da lo que vio omni-vision en cada cuadro (pedido con
 * CONFIANZA_SIGUE) y devuelve lo que hay que dibujar. `sostiene(o)` dice a cuáles se les aplica;
 * el resto pasa tal cual.
 */
export function sostenedor<T extends ConCaja>(sostiene: (o: T) => boolean = () => true) {
    let antes: { o: T; visto: number }[] = [];
    return (objetos: T[], ahora: number): T[] => {
        const libres = new Set(antes.keys());
        const quedan: { o: T; visto: number }[] = [], fuera: T[] = [];
        // Los de más confianza eligen primero con quién se emparejan.
        for (const o of [...objetos].sort((a, b) => b.confianza - a.confianza)) {
            if (!sostiene(o)) { fuera.push(o); continue; }
            let mejor = -1, cuanto = MISMO_IOU;
            for (const i of libres) { if (antes[i].o.grupo !== o.grupo) continue; const v = iou(antes[i].o.caja, o.caja); if (v > cuanto) { mejor = i; cuanto = v; } }
            if (mejor >= 0) { libres.delete(mejor); quedan.push({ o, visto: ahora }); }
            else if (o.confianza >= CONFIANZA_ENTRA) quedan.push({ o, visto: ahora });
        }
        // Los que estaban y este cuadro no trajo: se sostienen un instante, con su última silueta.
        for (const i of libres) if (ahora - antes[i].visto <= GRACIA_MS) quedan.push(antes[i]);
        antes = quedan;
        return [...quedan.map((q) => q.o), ...fuera];
    };
}
