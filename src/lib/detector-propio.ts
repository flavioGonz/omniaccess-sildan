/**
 * Detector propio: enseñarle al detector objetos que no trae de fábrica.
 *
 * El detector de OmniVision (RF-DETR) aprendió las 80 clases de COCO: personas, vehículos,
 * animales, mochilas. Un contenedor de basura, un cono o una carretilla no están, y ninguna
 * frase los hace aparecer: el detector no los encierra en una caja. Para eso hay que
 * re-entrenarlo con fotos donde una persona dibujó un recuadro sobre cada uno.
 *
 * Este archivo es lo que comparten la pantalla y el servidor: los topes, los números que se
 * piden y la validación de los recuadros. Sin base ni red.
 */

/** Por debajo de esto el entrenamiento no aprende la clase: memoriza esas fotos. */
export const CAJAS_MINIMO = 100;
/** Desde acá el detector suele andar bien en las cámaras de donde salieron las fotos. */
export const CAJAS_META = 300;
/**
 * Parte de las fotos que conviene que sean negativas (revisadas, sin nada): el mismo lugar sin
 * el objeto. Sin ellas el detector aprende «todo lo verde es un contenedor».
 */
export const NEGATIVAS_FRACCION = 0.15;
/** Un recuadro más chico que esto (fracción del lado) es un clic sin arrastrar, no un objeto. */
export const CAJA_MIN = 0.008;
export const LARGO_NOMBRE = 60;
export const LARGO_DESCRIPCION = 300;
/** Lado mayor con que se guarda una foto: lo que mira el entrenamiento, sin guardar 4K. */
export const LADO_MAX = 1920;

/**
 * Los tamaños de RF-DETR que se pueden entrenar acá. Nano por defecto: entra cómodo en la GPU de
 * 6 GB que comparte con el lector. Small ve mejor lo chico y lo lejano, y tarda el doble.
 */
export const MODELOS_ENTRENAMIENTO = [
    { id: "RFDETRNano", rotulo: "Rápido (Nano)", detalle: "384 px. El que conviene para empezar." },
    { id: "RFDETRSmall", rotulo: "Preciso (Small)", detalle: "512 px. Mejor con objetos chicos o lejos; tarda el doble." },
];
/** Épocas tope: con «parar si no mejora» casi nunca se llega, pero acota la noche. */
export const EPOCAS_MAX = 200;
/**
 * Lo que se usa si no se elige nada. Lote 4 × acumular 4 = 16 fotos por paso, lo que recomienda
 * rfdetr. Medido el 10/10 en la 3050 con Nano: pico de 3,7 GB de VRAM contando omni-lpr (con
 * omni-vision corriendo quedaban 2,6 GB libres: por eso se lo pausa). Se corta solo a las 15
 * épocas sin mejorar, o a las 3 horas.
 */
export const PARAMETROS_DEFECTO = { modelo: "RFDETRNano", epocas: 80, lote: 4, acumular: 4, lr: 1e-4, max_minutos: 180, paciencia: 15, hilos: 2, semilla: 7 };

export type Caja = { clase: string; caja: [number, number, number, number] };
export type ClaseResumen = { id: string; nombre: string; descripcion: string | null; cajas: number; fotos: number };
export type FotoFila = {
    id: string; url: string; ancho: number; alto: number; origen: string; deviceId: string | null;
    camara: string | null; cajas: Caja[]; revisada: boolean; createdAt: string;
};

/**
 * Normaliza y valida los recuadros que manda la pantalla. Devuelve el error en palabras en vez de
 * recortar en silencio: un recuadro fuera de la foto o de una clase borrada es un dato roto.
 */
export function validarCajas(x: unknown, clases: Set<string>): { cajas: Caja[] } | { error: string } {
    if (!Array.isArray(x)) return { error: "Los recuadros tienen que ser una lista." };
    const out: Caja[] = [];
    for (const c of x) {
        const k = (c as any)?.caja;
        const clase = String((c as any)?.clase || "");
        if (!clases.has(clase)) return { error: "Hay un recuadro de una clase que no existe (¿se borró?)." };
        if (!Array.isArray(k) || k.length !== 4 || k.some((v) => typeof v !== "number" || !Number.isFinite(v))) return { error: "Hay un recuadro mal formado." };
        const [a, b, cc, d] = k.map((v: number) => Math.min(1, Math.max(0, v)));
        const x1 = Math.min(a, cc), x2 = Math.max(a, cc), y1 = Math.min(b, d), y2 = Math.max(b, d);
        if (x2 - x1 < CAJA_MIN || y2 - y1 < CAJA_MIN) continue;  // un clic suelto: no es un recuadro
        out.push({ clase, caja: [x1, y1, x2, y2].map((v) => Math.round(v * 10000) / 10000) as Caja["caja"] });
    }
    return { cajas: out };
}

/** Lo que falta para poder entrenar, en palabras. Vacío = listo. */
export function falta(clases: ClaseResumen[], revisadas: number, negativas: number): string[] {
    const l: string[] = [];
    if (!clases.length) l.push("Crear al menos una clase.");
    for (const c of clases) if (c.cajas < CAJAS_MINIMO) l.push(`«${c.nombre}»: ${CAJAS_MINIMO - c.cajas} recuadros más (tiene ${c.cajas}).`);
    const negMin = Math.ceil(revisadas * NEGATIVAS_FRACCION);
    if (revisadas && negativas < negMin) l.push(`${negMin - negativas} fotos más sin ningún objeto (el mismo lugar, vacío).`);
    return l;
}
