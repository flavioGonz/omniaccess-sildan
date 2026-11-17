/**
 * Cómo se hace una muestra de una zona entrenable, en un solo lugar: el recorte y cómo se guarda
 * el vector.
 *
 * Lo usan dos: el worker (vision-zonas.js), que recorta el cuadro de ahora para tomar su muestra,
 * y la aplicación (src/lib/fotos-compartidas-servidor.ts), que recorta una foto del conjunto de
 * entrenamiento de objetos para reaprovecharla como muestra de la zona.
 *
 * Tiene que ser EL MISMO recorte, no uno parecido: el modelo de la zona es una dirección en el
 * espacio de SigLIP aprendida sobre recortes hechos así. Un margen distinto, o un lado distinto,
 * da un vector de otra distribución — el número que sale sigue pareciendo una probabilidad y ya no
 * quiere decir lo mismo. Por eso vive acá y no copiado en cada lado.
 */

/** Margen alrededor del rectángulo de la zona (fracción de su lado): lo que la rodea ayuda a reconocerla. */
const MARGEN = 0.04;
/** Lado máximo del recorte guardado: SigLIP mira a 384, más es disco sin ganancia. */
const LADO_MUESTRA = 384;

/**
 * El rectángulo envolvente de la zona (polígono en fracciones 0-1) sobre una imagen de W×H,
 * con el margen, en píxeles enteros y dentro de la imagen.
 */
function recuadroDeZona(zona, W, H) {
    const xs = zona.map((p) => p[0]), ys = zona.map((p) => p[1]);
    let x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
    const mx = (x2 - x1) * MARGEN, my = (y2 - y1) * MARGEN;
    x1 = Math.max(0, x1 - mx); y1 = Math.max(0, y1 - my); x2 = Math.min(1, x2 + mx); y2 = Math.min(1, y2 + my);
    const left = Math.floor(x1 * W), top = Math.floor(y1 * H);
    const width = Math.max(8, Math.min(W - left, Math.ceil((x2 - x1) * W)));
    const height = Math.max(8, Math.min(H - top, Math.ceil((y2 - y1) * H)));
    return { left, top, width, height };
}

/** El recorte ya listo para guardar o para pedirle el vector a omni-vision. */
async function recortarZona(sharp, jpeg, zona) {
    const { width: W, height: H } = await sharp(jpeg).metadata();
    return sharp(jpeg).extract(recuadroDeZona(zona, W, H))
        .resize(LADO_MUESTRA, LADO_MUESTRA, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 }).toBuffer();
}

/** Normaliza el vector que devuelve omni-vision (el modelo de la zona trabaja sobre unitarios). */
function normalizar(v) { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map((x) => x / n); }

/**
 * El vector como se guarda: int8 con su escala, un cuarto del tamaño. Lo lee `deInt8` de
 * src/lib/zona-entrenable.ts — tiene que ser esta misma cuenta o el vector se lee corrido.
 */
function aInt8(v) {
    const max = Math.max(...v.map((x) => Math.abs(x))) || 1;
    return { vector: Buffer.from(Int8Array.from(v, (x) => Math.round((x / max) * 127)).buffer), escala: max / 127 };
}

module.exports = { MARGEN, LADO_MUESTRA, recuadroDeZona, recortarZona, normalizar, aInt8 };
