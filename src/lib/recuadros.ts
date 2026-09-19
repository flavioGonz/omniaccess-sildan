/**
 * ¿Ese recuadro puede ser una matrícula?
 *
 * El lector devuelve texto aunque no haya chapa, y `pareceMatricula` filtra por la FORMA
 * del texto: largo razonable, letras y números. Eso alcanza contra `1111`, pero no contra
 * lo que sigue entrando:
 *
 *     1QQ3UP1   confianza 0.962   la mas alta de todo el historial
 *     PRGI790L  confianza 0.898
 *     2JVOOQ    confianza 0.887
 *
 * Y acá está el dato que rompe la intuición: **el OCR está más seguro de la basura que de
 * las chapas de verdad.** En el mismo historial, `SQT3730` — un auto real, leído en diez
 * cuadros — tiene 0.550. Subir el umbral de confianza tiraría autos y dejaría el ruido.
 *
 * Tampoco sirve la forma del texto: el barrio recibe chapas de cualquier país, y entre
 * Uruguay, Argentina y Brasil los moldes son tan distintos que exigir uno tira lecturas
 * reales. `PRGI790L` tiene forma de chapa. Lo que no tiene es tamaño de chapa.
 *
 * Lo que sí las separa es DÓNDE y DE QUÉ TAMAÑO cayó el recuadro:
 *
 *     1QQ3UP1    y = -0.043   h = 0.339    un rectángulo vertical, saliéndose del cuadro
 *     PRGI790L   x = -0.018   w = 0.148    cuatro veces más ancho que cualquier chapa
 *     2JVOOQ                  area 3.3x    junto a otro igual, en el mismo segundo
 *
 * contra las treinta y cuatro lecturas reales del mismo día, todas con el área dentro de
 * un factor de dos de la mediana de su cámara.
 *
 * Son dos reglas, y ninguna mira el texto:
 *
 *   1. El recuadro cae DENTRO del cuadro. Un recuadro que se sale por el borde no es una
 *      chapa leída: es el detector agarrando algo cortado. No tiene parámetros: es
 *      geometría.
 *
 *   2. El área se parece a la de las chapas que esa cámara viene leyendo. No hay número
 *      fijo posible — una chapa ocupa lo que la distancia y el lente digan, y eso cambia
 *      de cámara en cámara —, así que la referencia se saca de la propia cámara y el
 *      único parámetro es cuánto se tolera desviarse. Sin muestras suficientes no se
 *      filtra: preferible dejar pasar ruido que rechazar por una referencia inventada.
 */

export type Caja = { x: number; y: number; w: number; h: number };

/**
 * Cuánto puede alejarse del área típica, hacia arriba y hacia abajo.
 *
 * Área y no ancho: un cartel puede tener el ancho de una chapa y el triple de alto, y el
 * producto lo delata mientras que el ancho solo lo deja pasar.
 *
 * **Y los dos límites no son iguales**, que es lo que salió de probar el filtro contra un
 * día entero de lecturas reales. Con un único factor de 2,5 se frenaban nueve de las diez
 * basuras, pero también `SCK4428` —una chapa uruguaya perfecta, un auto que simplemente
 * pasó cerca de la cámara— que dio 3,1 veces el área típica.
 *
 * El área de una chapa cae con el CUADRADO de la distancia: un auto a la mitad de la
 * distancia da cuatro veces el área. Que una lectura sea grande es normal y esperable.
 * Que sea chica también, pero con un piso: por debajo de cierto tamaño el OCR ya no
 * distingue los caracteres, así que un recuadro diminuto que devolvió texto muy seguro es
 * justamente lo sospechoso — y ahí es donde cayeron `1111`, `11111`, `611111`, `LA1111H`
 * y `CWA111`, todas alrededor de un cuarto del área típica.
 *
 * Así que arriba se es generoso y abajo estricto. El precio es dejar pasar una basura más
 * (`2JVOOQ`, 3,3 veces), y se paga con gusto: una lectura de ruido se ve en el historial
 * y se ignora; un auto que el filtro se comió no se recupera nunca, y nadie se entera de
 * que falta.
 */
export const FACTOR_AREA_MAX = Number(process.env.TRACKING_BOX_AREA_MAX || 4);
export const FACTOR_AREA_MIN = Number(process.env.TRACKING_BOX_AREA_MIN || 2.5);

/** Cuántas lecturas hacen falta para que la referencia de esa cámara valga algo. */
export const MUESTRAS_MIN = Number(process.env.TRACKING_BOX_SAMPLES || 8);

/**
 * Cuánto se le perdona salirse del borde.
 *
 * No es cero porque el detector redondea y una chapa pegada al borde puede dar -0.002.
 * Pero es chico: -0.018 y -0.043, los dos casos reales de ruido, quedan afuera.
 */
export const BORDE = Number(process.env.TRACKING_BOX_EDGE || 0.01);

export const leerCaja = (v: any): Caja | null => {
    try {
        const c = typeof v === "string" ? JSON.parse(v) : v;
        return c && [c.x, c.y, c.w, c.h].every((n: any) => Number.isFinite(Number(n)))
            ? { x: Number(c.x), y: Number(c.y), w: Number(c.w), h: Number(c.h) }
            : null;
    } catch { return null; }
};

export const area = (c: Caja) => Math.abs(c.w * c.h);

/** Un recuadro entero adentro del cuadro. */
export function dentroDelCuadro(c: Caja) {
    return c.x >= -BORDE && c.y >= -BORDE
        && c.x + c.w <= 1 + BORDE && c.y + c.h <= 1 + BORDE
        && c.w > 0 && c.h > 0;
}

/** El área típica de esa cámara. `null` cuando todavía no hay con qué compararla. */
export function areaTipica(cajas: Caja[]): number | null {
    const areas = cajas.map(area).filter((a) => a > 0).sort((p, q) => p - q);
    if (areas.length < MUESTRAS_MIN) return null;
    // Mediana y no promedio: un solo recuadro enorme ya aceptado corre el promedio lo
    // suficiente como para dejar entrar al siguiente, y al siguiente.
    const m = Math.floor(areas.length / 2);
    return areas.length % 2 ? areas[m] : (areas[m - 1] + areas[m]) / 2;
}

/**
 * ¿Puede ser la chapa de un vehículo?
 *
 * Devuelve el motivo cuando no, para que quede dicho en la respuesta en vez de
 * desaparecer en silencio: una lectura descartada sin explicación es indistinguible de
 * una lectura que nunca llegó, y eso vuelve imposible darse cuenta de que el filtro está
 * comiéndose autos de verdad.
 */
export function pareceChapa(c: Caja | null, referencia: number | null): { ok: boolean; motivo?: string } {
    if (!c) return { ok: true };
    if (!dentroDelCuadro(c)) return { ok: false, motivo: "el recuadro se sale del cuadro" };
    if (referencia == null) return { ok: true };
    const a = area(c);
    if (a > referencia * FACTOR_AREA_MAX) return { ok: false, motivo: "el recuadro es demasiado grande para ser una chapa acá" };
    if (a * FACTOR_AREA_MIN < referencia) return { ok: false, motivo: "el recuadro es demasiado chico para ser una chapa acá" };
    return { ok: true };
}
