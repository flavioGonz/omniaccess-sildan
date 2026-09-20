import { spawn } from "child_process";

/**
 * La franja de estacionamiento: medir si un LUGAR está ocupado, no si una CHAPA sigue.
 *
 * ## Por qué se cambió el criterio
 *
 * El motor anterior preguntaba "¿esta chapa sigue ahí?", y la única prueba disponible era
 * otra lectura de la misma chapa. Una lectura, sin embargo, es un evento sobre una chapa
 * que cruzó el cuadro: no dice nada sobre si el vehículo está quieto. El parche de la
 * vigilia intentó tapar ese hueco comparando los píxeles alrededor del último recuadro, y
 * ahí nació el falso positivo que se veía en el mapa: **un pedazo de calle vacía también se
 * ve igual de una mirada a la otra**, así que "no cambió nada" se leía como "el auto sigue".
 *
 * Treinta horas de Calle 22 con ese criterio: siete estadías para `AAU9032`, un solo auto
 * que no se movió nunca. Y en Calle 21, tres autos (`SDM1707`, `SDH1707`, `5DH177`) que
 * eran el mismo, porque el OCR lo leyó distinto cada vez.
 *
 * Acá la pregunta cambia de sujeto y por eso se puede contestar:
 *
 * | | criterio viejo | franja |
 * |---|---|---|
 * | pregunta | ¿esta chapa sigue? | ¿este polígono está ocupado? |
 * | el polígono | se mueve con el auto | **no se mueve nunca** |
 * | referencia | la mirada anterior | el aspecto **vacío**, aprendido |
 * | tamaño de la señal | mínimo | un auto tapa la celda entera |
 * | costo | OCR en GPU | ffmpeg y aritmética |
 * | la chapa | **prueba** la permanencia | sólo le pone **nombre** |
 *
 * ## Las celdas siguen la perspectiva
 *
 * La franja son cuatro esquinas en orden `a, b, c, d`: `a→b` es un lado largo y `d→c` el
 * opuesto. La celda *i* va de `lerp(a,b)` a `lerp(d,c)`, así que se achica sola hacia el
 * fondo, igual que los autos. Dividir un rectángulo en partes iguales no serviría: una
 * cámara de calle mira en diagonal, y el error de suponer lo contrario ya se pagó una vez
 * con la caja del vehículo deducida por regla de tres (arquitectura §3.11).
 *
 * ## Por qué se compara por correlación y no por diferencia
 *
 * La diferencia cruda entre dos recortes se mueve con la luz: al atardecer **toda** la
 * imagen se oscurece y todos los lugares darían "cambió". La correlación normalizada
 * compara el *patrón* después de sacarle el brillo y el contraste, así que es ciega al
 * cambio de luz y sensible a que haya aparecido otra cosa. Es exactamente la separación
 * que hace falta para que la franja funcione de noche sin una referencia por hora del día.
 *
 * ## Dónde este método es débil, dicho acá y no escondido
 *
 * Un auto de color plano sobre asfalto de color plano deja los dos patrones sin textura, y
 * ahí la correlación no significa nada — por eso se mira **también** cuánta textura tiene
 * la celda, que es lo que un auto agrega (vidrios, ruedas, la sombra de abajo). Aun así
 * este es el caso que puede fallar, y conviene saberlo antes de que sorprenda.
 */

export type Punto = { x: number; y: number };
/** `a, b` un lado largo de la franja; `c, d` el opuesto, recorrido al revés. */
export type Esquinas = [Punto, Punto, Punto, Punto];

/** Ancho al que se achica el cuadro para medir. No hace falta más: se miden manchas, no chapas. */
export const ANCHO_MIRADA = Number(process.env.TRACKING_FRANJA_ANCHO || 320);

/** Muestras por celda: a lo largo y a lo ancho. El producto es el largo de la huella. */
export const MUESTRAS_LARGO = Number(process.env.TRACKING_FRANJA_MUESTRAS_LARGO || 12);
export const MUESTRAS_ANCHO = Number(process.env.TRACKING_FRANJA_MUESTRAS_ANCHO || 5);

/**
 * Cada muestra es el PROMEDIO de su casilla, no el píxel del centro.
 *
 * Esto no es un refinamiento: sin promediar, el método no funciona, y el número que lo
 * demuestra es feo. Con muestras de un píxel, dos cuadros de la misma calle tomados con
 * veinticinco segundos de diferencia —sin que se moviera nada— dieron correlaciones de
 * 0,39, 0,28 y 0,085, y las seis celdas salieron OCUPADAS. Un píxel suelto de una escena
 * con detalle cambia con el viento, con la compresión y con el temblor del poste; treinta
 * y dos píxeles sueltos no son una huella de nada, son ruido.
 *
 * El promedio de la casilla es un filtro pasabajos, que es justamente lo que hace robusta
 * la comparación de miniaturas. Cuesta unas pocas sumas más por celda.
 */
const MUESTRA_MIN_PX = 2;

/**
 * Por debajo de esta correlación con el lugar vacío, hay algo.
 *
 * Medido sobre la Calle 22, franja de seis lugares, dos cuadros separados por veinte
 * segundos sin que se moviera nada, y un tercero con un rectángulo gris tapando el lugar 3:
 *
 * | lugar | sin cambios | con el auto |
 * |---|---|---|
 * | 1 | 0,999 | 0,999 |
 * | 2 | 0,998 | 0,998 |
 * | **3** | **0,765** | **0,356** |
 * | 4 | 0,675 | 0,675 |
 * | 5 | 0,999 | 0,999 |
 * | 6 | 0,998 | 0,998 |
 *
 * El 0,50 va justo en el medio del hueco entre el peor caso quieto (0,675) y el auto
 * (0,356). Se eligió el medio y no un valor cómodo de un lado porque los dos errores
 * duelen: marcar un auto que no está fue el problema original, y perder uno que sí está
 * vacía el panel sin que nadie se entere.
 *
 * Y el auto de la prueba es un rectángulo gris liso, o sea el caso MÁS difícil: un auto de
 * verdad tiene vidrios, ruedas y sombra abajo, y baja más la correlación. El margen real es
 * más ancho que el medido.
 *
 * Los lugares 3 y 4 quedan bastante más abajo que el resto con la calle quieta. Eso es lo
 * que hay que vigilar si algún día esto marca de más: son las celdas donde algo se mueve
 * solo (tránsito de fondo, ramas), y son las que primero van a rozar el umbral.
 */
export const CORRELACION_MIN = Number(process.env.TRACKING_FRANJA_CORRELACION || 0.50);

/**
 * Cuánto tiene que cambiar la textura de la celda para contar como ocupada por sí sola.
 *
 * Es el respaldo para el caso plano-sobre-plano de arriba: un auto agrega bordes donde el
 * asfalto no tiene ninguno. Se mide como cociente para que sea independiente de la luz.
 */
export const TEXTURA_FACTOR = Number(process.env.TRACKING_FRANJA_TEXTURA || 1.9);

/**
 * Piso de textura para que el cociente de arriba signifique algo.
 *
 * Sin este piso la señal de respaldo se dispara sola: dos celdas casi lisas tienen
 * desviaciones minúsculas, y el cociente entre dos números minúsculos salta de 0,3 a 3 por
 * nada. En la primera prueba eso marcó las seis celdas como ocupadas con la calle vacía.
 * Dividir ruido por ruido no es una medición.
 */
export const TEXTURA_PISO = Number(process.env.TRACKING_FRANJA_TEXTURA_PISO || 4);

/**
 * Por debajo de esta textura en TODO el cuadro, la imagen no sirve para juzgar nada.
 *
 * Cubre tres cosas distintas con una sola regla: el cuadro roto que a veces devuelve el
 * decodificador HEVC, la cámara que se quedó a oscuras, y el lente tapado. En los tres
 * casos la respuesta correcta es "no pude mirar", y no "están todos ocupados" — que es lo
 * que saldría si se juzgara igual, porque una imagen gris no se parece a nada.
 */
export const CUADRO_PISO = Number(process.env.TRACKING_FRANJA_CUADRO_PISO || 8);

/** Cuántas vueltas seguidas hace falta para abrir y para cerrar. */
export const VUELTAS_OCUPAR = Number(process.env.TRACKING_FRANJA_VUELTAS_OCUPAR || 2);
export const VUELTAS_LIBERAR = Number(process.env.TRACKING_FRANJA_VUELTAS_LIBERAR || 3);

/**
 * Cuánto se corrige la referencia vacía en cada vuelta en que el lugar está libre.
 *
 * Chico a propósito: la referencia tiene que seguir al día que pasa, no a una bolsa que
 * voló y se quedó diez minutos. Con 0,04 y una vuelta por minuto, la referencia tarda
 * cerca de media hora en adoptar un cambio permanente y no se inmuta ante uno pasajero.
 */
export const MEZCLA_VACIO = Number(process.env.TRACKING_FRANJA_MEZCLA || 0.04);

export const leerEsquinas = (v: any): Esquinas | null => {
    try {
        const p = typeof v === "string" ? JSON.parse(v) : v;
        if (!Array.isArray(p) || p.length !== 4) return null;
        const q = p.map((n: any) => ({ x: Number(n?.x), y: Number(n?.y) }));
        return q.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)) ? (q as Esquinas) : null;
    } catch { return null; }
};

const mezclar = (p: Punto, q: Punto, t: number): Punto => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });

/**
 * Un punto dentro de la celda `i`, en coordenadas `u` (a lo largo) y `v` (a lo ancho),
 * las dos entre 0 y 1. En fracciones del cuadro.
 */
export function puntoEnCelda(esq: Esquinas, i: number, lugares: number, u: number, v: number): Punto {
    const [a, b, c, d] = esq;
    const t = (i + u) / lugares;
    // El lado a→b y el lado d→c avanzan juntos: entre los dos queda el ancho de la franja.
    return mezclar(mezclar(a, b, t), mezclar(d, c, t), v);
}

/** Las cuatro esquinas de la celda `i`, para dibujarla. */
export function celda(esq: Esquinas, i: number, lugares: number): Esquinas {
    return [
        puntoEnCelda(esq, i, lugares, 0, 0),
        puntoEnCelda(esq, i, lugares, 1, 0),
        puntoEnCelda(esq, i, lugares, 1, 1),
        puntoEnCelda(esq, i, lugares, 0, 1),
    ];
}

export type Mirada = { datos: Uint8Array; ancho: number; alto: number };

/**
 * El cuadro en grises y chiquito, crudo.
 *
 * Se achica una sola vez y se muestrea en JS en vez de pedirle a ffmpeg un recorte por
 * celda: son ocho procesos menos por vuelta, y además el recorte rectangular de ffmpeg no
 * puede seguir una celda en diagonal — le entraría pedazo de la vereda.
 */
export function enGrises(jpeg: Buffer, ancho = ANCHO_MIRADA): Promise<Mirada> {
    return new Promise((resolve, reject) => {
        const ff = spawn("ffmpeg", [
            "-hide_banner", "-loglevel", "error",
            "-i", "pipe:0",
            "-vf", `scale=${ancho}:-2,format=gray`,
            "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
        ]);
        const trozos: Buffer[] = [];
        const corte = setTimeout(() => { ff.kill("SIGKILL"); reject(new Error("ffmpeg no contestó")); }, 10000);
        ff.stdout.on("data", (d) => trozos.push(d));
        ff.on("error", (e) => { clearTimeout(corte); reject(e); });
        ff.on("close", () => {
            clearTimeout(corte);
            const buf = Buffer.concat(trozos);
            if (buf.length < ancho) return reject(new Error("ffmpeg no devolvió imagen"));
            resolve({ datos: new Uint8Array(buf), ancho, alto: Math.floor(buf.length / ancho) });
        });
        ff.stdin.on("error", () => { /* si ffmpeg ya murió, el close de arriba lo cuenta */ });
        ff.stdin.end(jpeg);
    });
}

/** El promedio de un cuadradito alrededor del punto. Ver `MUESTRA_MIN_PX`. */
const parche = (m: Mirada, fx: number, fy: number, radio: number): number => {
    const cx = Math.min(m.ancho - 1, Math.max(0, Math.round(fx * m.ancho)));
    const cy = Math.min(m.alto - 1, Math.max(0, Math.round(fy * m.alto)));
    let suma = 0, n = 0;
    for (let y = cy - radio; y <= cy + radio; y++) {
        if (y < 0 || y >= m.alto) continue;
        for (let x = cx - radio; x <= cx + radio; x++) {
            if (x < 0 || x >= m.ancho) continue;
            suma += m.datos[y * m.ancho + x];
            n++;
        }
    }
    return n ? suma / n : 0;
};

/** La huella de una celda: una grilla fija de muestras, en el orden en que se recorre. */
export function huellaDeCelda(m: Mirada, esq: Esquinas, i: number, lugares: number): number[] {
    /* El radio del promedio sale del tamaño real de la celda en esta imagen, no de una
       constante: las celdas del fondo son mucho más chicas que las de adelante, y un radio
       fijo les metería adentro pedazos de la vereda. */
    const q = celda(esq, i, lugares);
    const anchoPx = Math.abs(Math.max(...q.map((n) => n.x)) - Math.min(...q.map((n) => n.x))) * m.ancho;
    const altoPx = Math.abs(Math.max(...q.map((n) => n.y)) - Math.min(...q.map((n) => n.y))) * m.alto;
    const radio = Math.max(
        MUESTRA_MIN_PX,
        Math.round(Math.min(anchoPx / MUESTRAS_LARGO, altoPx / MUESTRAS_ANCHO) / 2),
    );

    const h: number[] = [];
    for (let a = 0; a < MUESTRAS_LARGO; a++) {
        for (let b = 0; b < MUESTRAS_ANCHO; b++) {
            // El +0.5 centra la muestra en su casilla: en los bordes, la mitad de la
            // muestra caería sobre la celda vecina o fuera de la franja.
            const p = puntoEnCelda(esq, i, lugares, (a + 0.5) / MUESTRAS_LARGO, (b + 0.5) / MUESTRAS_ANCHO);
            h.push(parche(m, p.x, p.y, radio));
        }
    }
    return h;
}

const promedio = (v: number[]) => v.reduce((s, n) => s + n, 0) / (v.length || 1);

/** Cuánta textura tiene la celda. Un auto agrega bordes donde el asfalto no tiene ninguno. */
export function textura(v: number[]): number {
    const m = promedio(v);
    return Math.sqrt(promedio(v.map((n) => (n - m) * (n - m))));
}

/**
 * Correlación normalizada entre dos huellas: 1 es el mismo patrón, 0 es nada que ver.
 *
 * Devuelve `null` cuando alguna de las dos no tiene textura suficiente como para que el
 * número signifique algo — y decirlo es mejor que devolver un 0 que quien llama va a leer
 * como "cambió todo".
 */
export function correlacion(a: number[], b: number[]): number | null {
    if (a.length !== b.length || !a.length) return null;
    const ma = promedio(a), mb = promedio(b);
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < a.length; i++) {
        const da = a[i] - ma, db = b[i] - mb;
        sab += da * db; saa += da * da; sbb += db * db;
    }
    // Un piso, no un cero: una celda perfectamente plana da 0 exacto sólo en teoría.
    if (saa < a.length || sbb < a.length) return null;
    return sab / Math.sqrt(saa * sbb);
}

export type EstadoCelda = {
    lugar: number;
    ocupado: boolean;
    /** `null` cuando las dos huellas están planas y el número no significaría nada. */
    correlacion: number | null;
    textura: number;
    texturaVacia: number;
    /** En palabras, para que el calibrador pueda mostrar por qué dijo lo que dijo. */
    motivo: string;
};

/**
 * ¿Está ocupada esta celda?
 *
 * Dos señales, y alcanza con una. La correlación es la principal; la textura es la que
 * salva el caso plano-sobre-plano donde la correlación no puede opinar.
 */
export function juzgarCelda(lugar: number, ahora: number[], vacia: number[]): EstadoCelda {
    const r = correlacion(ahora, vacia);
    const ta = textura(ahora), tv = textura(vacia);
    const hayDeQueHablar = Math.max(ta, tv) >= TEXTURA_PISO;
    const masTextura = hayDeQueHablar && tv > 0 && ta / tv >= TEXTURA_FACTOR;
    const menosTextura = hayDeQueHablar && ta > 0 && tv / ta >= TEXTURA_FACTOR;

    if (r != null && r < CORRELACION_MIN) {
        return { lugar, ocupado: true, correlacion: r, textura: ta, texturaVacia: tv, motivo: "el lugar no se parece a como está vacío" };
    }
    if (masTextura || menosTextura) {
        return { lugar, ocupado: true, correlacion: r, textura: ta, texturaVacia: tv, motivo: "cambió cuánto detalle tiene el lugar" };
    }
    if (r == null && !masTextura && !menosTextura) {
        // Las dos huellas planas y parecidas en textura: lo más probable es asfalto vacío.
        return { lugar, ocupado: false, correlacion: null, textura: ta, texturaVacia: tv, motivo: "el lugar está liso, como vacío" };
    }
    return { lugar, ocupado: false, correlacion: r, textura: ta, texturaVacia: tv, motivo: "el lugar se ve como cuando está vacío" };
}

export const leerVacio = (v: any): number[][] | null => {
    try {
        const p = typeof v === "string" ? JSON.parse(v) : v;
        return Array.isArray(p) && p.length && Array.isArray(p[0]) ? (p as number[][]) : null;
    } catch { return null; }
};

/** Las huellas de todas las celdas de una franja, en un cuadro. */
export function huellasDeLaFranja(m: Mirada, esq: Esquinas, lugares: number): number[][] {
    return Array.from({ length: lugares }, (_, i) => huellaDeCelda(m, esq, i, lugares));
}

/**
 * La referencia vacía, corregida con lo que se ve ahora en los lugares libres.
 *
 * Sin esto la referencia envejece: al anochecer el asfalto cambia de aspecto y la franja
 * empezaría a marcar autos que no hay. Sólo se corrige donde está libre — un lugar ocupado
 * no aporta nada sobre cómo se ve vacío.
 */
export function refrescarVacio(vacio: number[][], ahora: number[][], libres: boolean[]): number[][] {
    return vacio.map((v, i) => (
        libres[i] && ahora[i]?.length === v.length
            ? v.map((n, j) => n + (ahora[i][j] - n) * MEZCLA_VACIO)
            : v
    ));
}

/** ¿Está el punto adentro de este polígono? Cruces de una semirrecta, lo de siempre. */
export function dentroDelPoligono(poli: Punto[], p: Punto): boolean {
    let dentro = false;
    for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
        const a = poli[i], b = poli[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
    }
    return dentro;
}

/**
 * ¿En qué lugar de la franja cayó este punto del cuadro? `null` si cayó afuera.
 *
 * Se prueba contra las mismas celdas que se dibujan, y no contra una fórmula aparte, para
 * que no puedan discrepar: un lugar que se pinta ocupado y otro que recibe la chapa sería
 * el peor de los errores posibles acá — parecería andar y estaría mintiendo.
 */
export function lugarDelPunto(esq: Esquinas, lugares: number, p: Punto): number | null {
    for (let i = 0; i < lugares; i++) if (dentroDelPoligono(celda(esq, i, lugares), p)) return i;
    return null;
}

/** ¿Este cuadro sirve para juzgar? Ver `CUADRO_PISO`. */
export function cuadroUtil(m: Mirada): { ok: boolean; contraste: number } {
    let suma = 0;
    for (let i = 0; i < m.datos.length; i++) suma += m.datos[i];
    const media = suma / m.datos.length;
    let sq = 0;
    for (let i = 0; i < m.datos.length; i++) { const d = m.datos[i] - media; sq += d * d; }
    const contraste = Math.sqrt(sq / m.datos.length);
    return { ok: contraste >= CUADRO_PISO, contraste };
}
