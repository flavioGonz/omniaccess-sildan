/**
 * Reaprovechar las fotos entre los dos entrenamientos.
 *
 * Pedido del 16/11 (Nico): «cuando uno dispara fotos, ya sea entrenamiento de escena u objetos,
 * las fotos deben ambos poder usarlas, así reaprovechamos las imágenes capturadas para entrenar».
 *
 * Son dos conjuntos distintos y eso no cambia: la analítica de escena guarda el RECORTE de su zona
 * con su vector SigLIP, y el detector de objetos guarda el CUADRO ENTERO con los recuadros que
 * alguien dibujó. Lo que se comparte es la imagen, no la etiqueta:
 *
 *  · Del conjunto de objetos a una zona: el cuadro entero de esa cámara se recorta por la zona y
 *    entra como muestra sin etiquetar, igual que si la hubiera tomado el worker. Una foto tomada
 *    hace tres semanas a las tres de la mañana vale lo mismo que una de ahora, y ya estaba sacada.
 *  · De una zona al conjunto de objetos: el recorte entra como una foto más, para dibujarle los
 *    recuadros. Son justamente las fotos difíciles — el pedazo de escena que importa, con el
 *    tamaño en píxeles que el objeto tiene de verdad en esa cámara.
 *
 * Las dos reglas que evitan que esto se muerda la cola:
 *  · Una foto que SALIÓ de una zona no vuelve a entrar como muestra de zona. Es un recorte de 384
 *    px ya mirado; recortarle otra vez la zona da un pedazo del pedazo.
 *  · Una muestra que VINO de una foto no se manda al conjunto de objetos: esa imagen ya está ahí.
 */

export type FotoDelConjunto = {
    id: string;
    deviceId: string | null;
    origen: string;
    createdAt: string;
};

export type MuestraParaCompartir = {
    id: string;
    fotoId?: string | null;
    etiqueta?: string | null;
};

/** El origen con el que entra al conjunto de objetos una foto que vino de una zona. */
export const ORIGEN_ZONA = "ZONA";
/**
 * `MuestraZona.fuente` dice CON QUÉ se la puntuó («entrenado» o «frases»), no de dónde salió la
 * imagen — de dónde salió lo dice `fotoId`. Esto queda para el caso en que no se pudo puntuar
 * (zona sin modelo y omni-vision sin contestar el vector de las frases): la muestra vale igual
 * para etiquetar, y así no miente diciendo que la miró un modelo.
 */
export const FUENTE_FOTO = "foto";

/**
 * Cuántas se traen de una. Cada una cuesta un vector de omni-vision (~80 ms) y el pedido tiene que
 * contestar: con más, el navegador espera de más y la GPU queda ocupada en esto.
 */
export const TOPE_TRAER = 40;

/**
 * Las fotos del conjunto de objetos que le sirven a una zona: las de SU cámara, que no se hayan
 * traído ya, y que no sean recortes salidos de una zona. De la más nueva a la más vieja, porque
 * la escena de hace un mes se parece menos a la de hoy.
 */
export function fotosQueSirven(
    fotos: FotoDelConjunto[],
    deviceId: string,
    yaTraidas: Iterable<string> = [],
    tope = TOPE_TRAER,
): FotoDelConjunto[] {
    const ya = new Set(yaTraidas);
    return fotos
        .filter((f) => f.deviceId === deviceId && f.origen !== ORIGEN_ZONA && !ya.has(f.id))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
        .slice(0, Math.max(0, tope));
}

/**
 * Las muestras que se pueden mandar al conjunto de objetos: las que tomó el worker (las que
 * vinieron de una foto ya están ahí). La etiqueta de la zona no decide nada acá: un recorte de
 * «normal» es un ejemplo negativo del detector, que hace tanta falta como los positivos.
 */
export function muestrasQueSirven(muestras: MuestraParaCompartir[]): MuestraParaCompartir[] {
    return muestras.filter((m) => !m.fotoId);
}
