/**
 * Analíticas entrenables: una zona FIJA de una cámara (el contenedor de basura, el portón, un
 * lugar de estacionamiento) que se clasifica en dos estados — el que avisa («Desbordado») y el
 * normal. Tres pasos, que son tres maneras de contestar la misma pregunta:
 *
 *  1. Sin ejemplos: frases. SigLIP compara el recorte con «contenedor desbordado, bolsas en el
 *     piso» contra «contenedor cerrado y ordenado». Sirve desde el primer minuto y junta muestras.
 *  2. Con ejemplos: un clasificador propio (prototipos calibrados, partiendo de las frases) sobre el vector SigLIP del
 *     recorte, entrenado con las muestras que alguien etiquetó. Aprende ESE contenedor, con esa
 *     luz y ese ángulo. Entrena en el procesador, en segundos: no toca la GPU del lector.
 *  3. El aviso: el estado que avisa sostenido `sostenerSeg` (una bolsa de paso no es un
 *     contenedor desbordado), en el horario de la zona.
 *
 * Por qué no el detector: ninguna clase de COCO es «contenedor», y tampoco hace falta encontrar
 * nada — el lugar no se mueve. Es clasificar un recorte, no detectar.
 *
 * La cuenta de la probabilidad está repetida en vision-zonas.js (el worker es CommonJS): si
 * cambia acá, cambia allá.
 */

export type Punto = [number, number];
export type Horario = { desde: string; hasta: string } | null;

export type ModeloZona = {
    /** Prototipos: `w` = promedio de los que avisan − promedio de los normales; `b` lo centra
     *  entre los dos. El puntaje crudo es w·v + b (positivo = más parecido a los que avisan). */
    w: number[]; b: number;
    /** Calibración (Platt): prob = sigmoide(a·puntaje + c), ajustada sobre la validación cruzada. */
    a: number; c: number; dim: number;
    /** Cuánto pesan las frases en la dirección (0 = sólo ejemplos, 1 = sólo frases); lo elige la validación. */
    guia?: number;
    n: { pos: number; neg: number };
    /** Exactitud balanceada en validación cruzada, en el punto de equilibrio (0,5). */
    exactitud: number | null;
    /** Matriz de la validación cruzada al umbral de la zona: verdaderos/falsos positivos y negativos. */
    matriz: { vp: number; fp: number; vn: number; fn: number } | null;
    pliegues: number;
    /** Con qué se decidió (el que mejor acertó en la validación) y cómo se validó. Los modelos de antes del 15/11 no lo traen: eran prototipos, mezclada. */
    metodo?: "prototipos" | "logistica";
    validacion?: "dias" | "tramos" | "mezclada";
    entrenado: string; por: string | null;
};

export type ZonaDatos = {
    nombre: string; deviceId: string; zona: Punto[];
    positivo: string; negativo: string;
    frasesPositivo: string[]; frasesNegativo: string[];
    cadaSeg: number; sostenerSeg: number; umbral: number;
    horario: Horario; avisar: boolean; activa: boolean;
};

/** Cada cuánto se mira: más seguido que 1 min no cambia nada en un contenedor y llena el disco de muestras. */
export const CADA_SEG = { min: 60, max: 3600, defecto: 300 };
/** Cuánto sostener antes de avisar: de inmediato hasta un día. */
export const SOSTENER_SEG = { min: 0, max: 86_400, defecto: 900 };
/**
 * Desde qué probabilidad es el estado que avisa. Menos de 0,5 sería avisar con el modelo diciendo
 * «más bien no». La calibración es balanceada (0,5 = igual de probable); 0,6 deja un margen, y el
 * ruido de una muestra suelta ya lo filtra el tiempo sostenido.
 */
export const UMBRAL = { min: 0.5, max: 0.99, defecto: 0.6 };
/** Con menos de esto por clase no se entrena: no hay con qué validar. */
export const MIN_POR_CLASE = 5;
/** Lo que suele alcanzar para que el acierto se estabilice; se muestra como meta. */
export const RECOMENDADO_POR_CLASE = 30;
const FRASES_MAX = 6;
/** Largos máximos: el formulario los muestra y el servidor los rechaza, nunca recorta callado. */
export const LARGO_NOMBRE = 80;
export const LARGO_ESTADO = 60;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validarZona(x: any): { datos: ZonaDatos | null; errores: string[] } {
    const errores: string[] = [];
    const texto = (v: any, max = 80) => String(v ?? "").trim().slice(0, max);
    const nombre = texto(x?.nombre, LARGO_NOMBRE), positivo = texto(x?.positivo, LARGO_ESTADO), negativo = texto(x?.negativo, LARGO_ESTADO);
    // Se rechaza en vez de recortar: «Cartel… Está prese» (10/10) salió de cortar en silencio.
    if (String(x?.nombre ?? "").trim().length > LARGO_NOMBRE) errores.push(`El nombre es muy largo (hasta ${LARGO_NOMBRE} letras).`);
    if (String(x?.positivo ?? "").trim().length > LARGO_ESTADO || String(x?.negativo ?? "").trim().length > LARGO_ESTADO) errores.push(`El nombre de un estado es muy largo (hasta ${LARGO_ESTADO} letras): es lo que sale en el aviso.`);
    if (!nombre) errores.push("Falta el nombre.");
    if (!positivo || !negativo) errores.push("Faltan los nombres de los dos estados.");
    if (positivo && negativo && positivo.toLowerCase() === negativo.toLowerCase()) errores.push("Los dos estados no pueden llamarse igual.");
    const deviceId = texto(x?.deviceId, 60);
    if (!deviceId) errores.push("Falta la cámara.");
    const zona: Punto[] = Array.isArray(x?.zona) ? x.zona.filter((p: any) => Array.isArray(p) && p.length === 2 && p.every((n: any) => Number.isFinite(n) && n >= 0 && n <= 1)).map((p: any) => [p[0], p[1]] as Punto) : [];
    if (zona.length < 3) errores.push("Dibujá la zona (tres puntos o más) sobre lo que hay que mirar.");
    const frases = (v: any, rotulo: string) => {
        const f = (Array.isArray(v) ? v : String(v ?? "").split("\n")).map((s: any) => texto(s, 200)).filter(Boolean).slice(0, FRASES_MAX);
        if (!f.length) errores.push(`Falta al menos una frase para «${rotulo || "el estado"}».`);
        return f;
    };
    const frasesPositivo = frases(x?.frasesPositivo, positivo), frasesNegativo = frases(x?.frasesNegativo, negativo);
    const entre = (v: any, l: { min: number; max: number; defecto: number }) => { const n = Number(v); return Number.isFinite(n) ? Math.min(l.max, Math.max(l.min, n)) : l.defecto; };
    let horario: Horario = null;
    if (x?.horario) {
        if (HORA.test(x.horario.desde) && HORA.test(x.horario.hasta)) horario = { desde: x.horario.desde, hasta: x.horario.hasta };
        else errores.push("El horario tiene que ser HH:MM a HH:MM.");
    }
    if (errores.length) return { datos: null, errores };
    return {
        datos: {
            nombre, deviceId, zona, positivo, negativo, frasesPositivo, frasesNegativo,
            cadaSeg: Math.round(entre(x?.cadaSeg, CADA_SEG)), sostenerSeg: Math.round(entre(x?.sostenerSeg, SOSTENER_SEG)),
            umbral: entre(x?.umbral, UMBRAL), horario, avisar: !!x?.avisar, activa: x?.activa !== false,
        },
        errores,
    };
}

export function normalizar(v: Float32Array): Float32Array {
    let n = 0; for (let i = 0; i < v.length; i++) n += v[i] * v[i];
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < v.length; i++) v[i] /= n;
    return v;
}
/** El vector guardado (int8 + escala) de vuelta a flotantes normalizados. */
export const deInt8 = (b: Uint8Array | Buffer, escala: number) => {
    const q = new Int8Array(b.buffer, b.byteOffset, b.byteLength);
    return normalizar(Float32Array.from(q, (x) => x * escala));
};

const sigmoide = (z: number) => 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, z))));

const producto = (a: ArrayLike<number>, b: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** Probabilidad del estado que avisa según el modelo entrenado; null si el vector no es de su tamaño. */
export function puntuar(m: ModeloZona | null | undefined, v: Float32Array): number | null {
    if (!m || !Array.isArray(m.w) || m.w.length !== v.length) return null;
    return sigmoide(m.a * (producto(m.w, v) + m.b) + m.c);
}

/**
 * El clasificador: prototipos (el promedio de cada estado) sobre el vector SigLIP.
 *
 * Se probó contra una regresión logística (con L2 y pesos por clase) y una regresión ridge
 * resuelta en forma cerrada, con datos sintéticos de 768 dimensiones: con 8+8 ejemplos la
 * logística dio entre 50 % y 81 % según la regularización —inestable justo donde más se va a
 * usar, con pocos ejemplos—; los prototipos dieron 88 % en validación y lo mismo que ridge con
 * 20+200, en una fracción del tiempo y sin resolver un sistema de n×n. Con datos sin nada que
 * aprender quedan en 50 %, que es lo honesto. Y se explica en una frase: «se parece más a los
 * desbordados que a los normales».
 */
const unitario = (a: ArrayLike<number>) => { let n = 0; for (let i = 0; i < a.length; i++) n += a[i] * a[i]; n = Math.sqrt(n) || 1; return Float64Array.from(a as ArrayLike<number>, (x) => x / n); };

/**
 * Prototipos, partiendo de las frases: la dirección es una mezcla de la de los ejemplos (promedio
 * de los que avisan − promedio de los normales) y la de las frases (lo mismo con los vectores de
 * texto), cada una de largo 1. El umbral se centra entre los dos promedios de los ejemplos.
 *
 * Por qué mezclar: con pocos ejemplos de lo raro, el promedio de 7 autos es ruido y la frase «un
 * auto en la calle» sabe más. Medido el 10/10 con la zona de prueba de LPR Entrada (7 + 56
 * etiquetados por Nico, dejando uno afuera cada vez): sólo ejemplos 65 %, sólo frases 79 %,
 * 75 % frases + 25 % ejemplos 84 %. Con muchos ejemplos gana la otra punta; por eso el peso no
 * es fijo sino que lo elige la validación cruzada en cada entrenamiento.
 */
function prototipos(X: Float32Array[], y: number[], guia: Float64Array | null, beta: number) {
    const d = X[0].length;
    const mp = new Float64Array(d), mn = new Float64Array(d);
    let np = 0, nn = 0;
    X.forEach((x, k) => { const m = y[k] ? mp : mn; if (y[k]) np++; else nn++; for (let i = 0; i < d; i++) m[i] += x[i]; });
    for (let i = 0; i < d; i++) { mp[i] /= np; mn[i] /= nn; }
    const propia = unitario(Float64Array.from(mp, (v, i) => v - mn[i]));
    const w = guia ? Float64Array.from(propia, (v, i) => (1 - beta) * v + beta * guia[i]) : propia;
    const centro = Float64Array.from(mp, (v, i) => (v + mn[i]) / 2);
    return { w, b: -producto(w, centro) };
}

/** La dirección de las frases (promedio de las del que avisa − promedio de las del normal), de largo 1. */
export function guiaDeFrases(positivas: Float32Array[], negativas: Float32Array[]): Float64Array | null {
    if (!positivas.length || !negativas.length) return null;
    const d = positivas[0].length;
    const g = new Float64Array(d);
    for (const v of positivas) for (let i = 0; i < d; i++) g[i] += v[i] / positivas.length;
    for (const v of negativas) for (let i = 0; i < d; i++) g[i] -= v[i] / negativas.length;
    return unitario(g);
}

/** Los pesos de las frases que se prueban en cada entrenamiento. */
const MEZCLAS = [0, 0.25, 0.5, 0.75, 1];

/**
 * Calibración de Platt: de puntaje crudo a probabilidad, con pesos por clase (con 300 normales
 * y 20 desbordados, sin pesos aprendería a decir siempre «normal» y acertaría el 94 %).
 */
function platt(puntos: { s: number; y: number }[]) {
    const n = puntos.length, np = puntos.filter((p) => p.y).length, nn = n - np;
    const sd = Math.sqrt(puntos.reduce((t, p) => t + p.s * p.s, 0) / n) || 1;
    let a = 1 / sd, c = 0;
    for (let it = 0; it < 2000; it++) {
        let ga = 0, gc = 0;
        for (const p of puntos) {
            const e = (sigmoide(a * p.s + c) - p.y) * (p.y ? n / (2 * np) : n / (2 * nn));
            ga += e * p.s; gc += e;
        }
        a -= (0.5 * ga / n) * sd * sd; c -= 0.5 * gc / n;
    }
    return { a, c };
}

/**
 * Regresión logística con L2 y pesos por clase, sobre el vector centrado. Devuelve lo mismo que
 * `prototipos` (w y b sobre el vector tal cual), así el worker hace la cuenta de siempre.
 *
 * Por qué volvió (15/11, Nico, con el vigía diciendo «Desbordado 68 %» sobre un contenedor: «no sé
 * cómo hacer para que sea acertada»). El 10/10 se descartó porque con 8 + 8 ejemplos era
 * inestable, y eso sigue siendo cierto. Pero los vigías ya tienen CIENTOS de ejemplos, y ahí los
 * prototipos son el techo. Medido ese día con lo etiquetado en el lab, validando por días enteros:
 *
 *                              prototipos                 logística
 *   Vigía 01 (344 + 1583)   89 %, 264 falsas alarmas    96 %, 28-36 falsas alarmas
 *   Vigía 02 (270 + 583)    66 %                        85 %
 *
 * La razón: el promedio de cada estado mezcla día y noche, sol y sombra (el vector distingue día
 * de noche casi perfecto, AUC 0,98), y la diferencia de promedios carga con eso. La logística
 * aprende qué direcciones NO importan. Por eso se la prueba recién con RECOMENDADO_POR_CLASE
 * ejemplos de cada estado, y gana sólo si acierta más en la validación.
 *
 * Cede el paso cada pocas vueltas: entrena dentro del servidor web, y unos segundos de cuenta
 * seguida le cortarían el video y los avisos a todos.
 */
const LOGISTICA = { lambda: 0.01, vueltas: 150, paso: 0.05, escala: 12, cederCada: 6 };
async function logistica(X: Float32Array[], y: number[]) {
    const n = X.length, d = X[0].length, E = LOGISTICA.escala;
    const mu = new Float64Array(d);
    for (const x of X) for (let i = 0; i < d; i++) mu[i] += x[i] / n;
    const Z = X.map((x) => Float32Array.from(x, (v, i) => (v - mu[i]) * E));
    const np = y.filter(Boolean).length, nn = n - np, pp = n / (2 * np), pn = n / (2 * nn);
    const w = new Float64Array(d), m = new Float64Array(d), v = new Float64Array(d), g = new Float64Array(d);
    let b = 0, mb = 0, vb = 0;
    const B1 = 0.9, B2 = 0.999;
    for (let it = 1; it <= LOGISTICA.vueltas; it++) {
        g.fill(0);
        let gb = 0;
        for (let k = 0; k < n; k++) {
            const z = Z[k];
            const e = (sigmoide(producto(w, z) + b) - y[k]) * (y[k] ? pp : pn) / n;
            for (let i = 0; i < d; i++) g[i] += e * z[i];
            gb += e;
        }
        const c1 = 1 - B1 ** it, c2 = 1 - B2 ** it;
        for (let i = 0; i < d; i++) {
            const gi = g[i] + LOGISTICA.lambda * w[i];
            m[i] = B1 * m[i] + (1 - B1) * gi; v[i] = B2 * v[i] + (1 - B2) * gi * gi;
            w[i] -= LOGISTICA.paso * (m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8);
        }
        mb = B1 * mb + (1 - B1) * gb; vb = B2 * vb + (1 - B2) * gb * gb;
        b -= LOGISTICA.paso * (mb / c1) / (Math.sqrt(vb / c2) + 1e-8);
        if (it % LOGISTICA.cederCada === 0) await new Promise<void>((r) => setImmediate(r));
    }
    // De vuelta al vector sin centrar: w·(x − mu)·E + b = (w·E)·x + (b − E·w·mu).
    const wf = Float64Array.from(w, (x) => x * E);
    return { w: wf, b: b - producto(wf, mu) };
}

/** Montevideo no cambia la hora: el día de una muestra es el de UTC−3. */
const DIA_LOCAL_MS = 3 * 3600_000;
/** Con menos días distintos que esto no se puede dejar días enteros afuera: se parte por tramos de tiempo. */
const DIAS_MIN = 3;

/**
 * En qué parte de la validación cae cada ejemplo.
 *
 * Hasta el 15/11 se repartían salteados (el 1.º a la parte 0, el 2.º a la 1…). Pero dos miradas
 * seguidas de un contenedor son casi la misma foto (medido: 1.424 pares vecinos con coseno ≥ 0,97
 * en el Vigía 01), así que cada ejemplo «que no vio» tenía a su gemelo del otro lado: el número
 * salía inflado. En el Vigía 02 la pantalla decía 80 % y, dejando afuera días enteros, daba 66 %.
 * Lo que importa es cómo va a andar MAÑANA: se dejan afuera días enteros. Con pocos días, tramos
 * seguidos de tiempo; sin fechas (las pruebas viejas), salteado como antes.
 */
export function partesDeValidacion(ejemplos: { y: number; t?: number }[], max = 5): { parte: number[]; partes: number; como: NonNullable<ModeloZona["validacion"]> } {
    const np = ejemplos.filter((e) => e.y === 1).length, nn = ejemplos.length - np;
    const salteado = () => { const partes = Math.max(2, Math.min(max, np, nn)); const k = [0, 0]; return { parte: ejemplos.map((e) => k[e.y]++ % partes), partes, como: "mezclada" as const }; };
    if (!ejemplos.every((e) => typeof e.t === "number" && Number.isFinite(e.t))) return salteado();
    const dia = (t: number) => Math.floor((t - DIA_LOCAL_MS) / 86_400_000);
    const dias = [...new Set(ejemplos.map((e) => dia(e.t!)))].sort((a, b) => a - b);
    if (dias.length >= DIAS_MIN) {
        const partes = Math.min(max, dias.length), deDia = new Map(dias.map((d, i) => [d, i % partes]));
        return { parte: ejemplos.map((e) => deDia.get(dia(e.t!))!), partes, como: "dias" };
    }
    const orden = ejemplos.map((e, i) => ({ i, t: e.t! })).sort((a, b) => a.t - b.t);
    const partes = Math.max(2, Math.min(max, np, nn)), parte = new Array<number>(ejemplos.length);
    orden.forEach((o, k) => { parte[o.i] = Math.min(partes - 1, Math.floor((k * partes) / orden.length)); });
    return { parte, partes, como: "tramos" };
}

type Ajuste = (X: Float32Array[], y: number[]) => Promise<{ w: Float64Array; b: number }> | { w: Float64Array; b: number };

/**
 * Entrena con todas las muestras etiquetadas y mide con validación cruzada: cada muestra se
 * predice con un modelo que no la vio, ni a ella ni a las de su mismo día (ver
 * `partesDeValidacion`). Ese número es el que se muestra; el acierto sobre lo mismo que se
 * entrenó siempre da cerca de 100 % y no dice nada.
 *
 * Se prueban los prototipos (con cada mezcla de frases) y, con ejemplos suficientes, la logística;
 * queda el que más acierta en la validación. A igual acierto, los prototipos: son más simples.
 */
export async function entrenar(ejemplos: { v: Float32Array; y: 0 | 1; t?: number }[], umbral: number, por: string | null, guia: Float64Array | null = null): Promise<ModeloZona> {
    const pos = ejemplos.filter((e) => e.y === 1), neg = ejemplos.filter((e) => e.y === 0);
    if (pos.length < MIN_POR_CLASE || neg.length < MIN_POR_CLASE) throw new Error(`Hacen falta al menos ${MIN_POR_CLASE} ejemplos de cada estado (hay ${pos.length} y ${neg.length}).`);
    let reparto = partesDeValidacion(ejemplos);
    const validar = async (ajuste: Ajuste) => {
        const puntos: { s: number; y: number }[] = [];
        for (let f = 0; f < reparto.partes; f++) {
            const tren = ejemplos.filter((_, i) => reparto.parte[i] !== f), prueba = ejemplos.filter((_, i) => reparto.parte[i] === f);
            // Una parte que se lleva casi todos los de un estado no deja con qué entrenar: esos ejemplos quedan sin medir.
            if (!prueba.length || tren.filter((e) => e.y === 1).length < MIN_POR_CLASE || tren.filter((e) => e.y === 0).length < MIN_POR_CLASE) continue;
            const m = await ajuste(tren.map((e) => e.v), tren.map((e) => e.y));
            for (const e of prueba) puntos.push({ s: producto(m.w, e.v) + m.b, y: e.y });
        }
        return puntos;
    };
    const medir = (puntos: { s: number; y: number }[]) => {
        const { a, c } = platt(puntos);
        // El acierto se mide en el punto de equilibrio (0,5): es la calidad del modelo.
        const bien = (y: number) => puntos.filter((p) => p.y === y && (sigmoide(a * p.s + c) >= 0.5 ? 1 : 0) === y).length / puntos.filter((p) => p.y === y).length;
        return { puntos, a, c, exactitud: 0.5 * (bien(1) + bien(0)) };
    };
    const medible = (puntos: { y: number }[]) => puntos.some((p) => p.y === 1) && puntos.some((p) => p.y === 0);
    type Candidato = { metodo: NonNullable<ModeloZona["metodo"]>; beta: number; ajuste: Ajuste };
    const candidatos: Candidato[] = (guia ? MEZCLAS : [0]).map((beta) => ({ metodo: "prototipos" as const, beta, ajuste: (X: Float32Array[], y: number[]) => prototipos(X, y, guia, beta) }));
    if (pos.length >= RECOMENDADO_POR_CLASE && neg.length >= RECOMENDADO_POR_CLASE) candidatos.push({ metodo: "logistica", beta: 0, ajuste: logistica });
    // Si por días todos los de un estado caen del lado que no se pudo medir, se mide como antes: peor que nada no es.
    if (reparto.como !== "mezclada" && !medible(await validar(candidatos[0].ajuste))) reparto = partesDeValidacion(ejemplos.map((e) => ({ y: e.y })));
    const pruebas: (Candidato & ReturnType<typeof medir>)[] = [];
    for (const c of candidatos) { const puntos = await validar(c.ajuste); if (medible(puntos)) pruebas.push({ ...c, ...medir(puntos) }); }
    if (!pruebas.length) throw new Error("No se pudo validar: hacen falta ejemplos de los dos estados en momentos distintos.");
    // El que mejor acierta en ejemplos que no vio. A igual acierto: prototipos antes que logística, y la mezcla más cerca de la mitad.
    const mejor = pruebas.reduce((x, y) => {
        if (y.exactitud > x.exactitud + 1e-9) return y;
        if (Math.abs(y.exactitud - x.exactitud) >= 1e-9 || y.metodo !== x.metodo) return x;
        return Math.abs(y.beta - 0.5) < Math.abs(x.beta - 0.5) ? y : x;
    });
    // La matriz, en cambio, va al umbral de la zona: es lo que de verdad dispararía.
    const matriz = { vp: 0, fp: 0, vn: 0, fn: 0 };
    for (const p of mejor.puntos) {
        const dice = sigmoide(mejor.a * p.s + mejor.c) >= umbral;
        if (p.y) dice ? matriz.vp++ : matriz.fn++;
        else dice ? matriz.fp++ : matriz.vn++;
    }
    const final = await mejor.ajuste(ejemplos.map((e) => e.v), ejemplos.map((e) => e.y));
    return {
        w: Array.from(final.w, (x) => +x.toFixed(6)), b: +final.b.toFixed(6), a: +mejor.a.toFixed(4), c: +mejor.c.toFixed(4), dim: final.w.length,
        guia: guia && mejor.metodo === "prototipos" ? mejor.beta : 0,
        n: { pos: pos.length, neg: neg.length }, exactitud: +mejor.exactitud.toFixed(4), matriz, pliegues: reparto.partes,
        metodo: mejor.metodo, validacion: reparto.como, entrenado: new Date().toISOString(), por,
    };
}
