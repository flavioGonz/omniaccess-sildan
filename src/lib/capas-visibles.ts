/**
 * Qué se dibuja sobre el video, capa por capa.
 *
 * Por qué (15/11, Nico: «capas de analíticas activables… tal vez sólo quiera siluetas de humanos,
 * o sólo matrículas, o sólo objetos entrenables; un menú con opciones para ver o no»). Había tres
 * botones sueltos —siluetas sí o no, la línea de la cámara, las zonas de las analíticas— y ninguna
 * manera de quedarse con una parte: en una entrada llena de autos, el que busca a una persona
 * tenía que mirarla entre quince siluetas de vehículos.
 *
 * Lo elegido vale para el vivo y para la grabación, y se recuerda en el navegador.
 *
 * Lo que NO hace, medido ese día sobre un canal lleno: no acelera el análisis. El detector mira el
 * cuadro entero una sola vez y tarda lo mismo se pida un grupo o los cuatro (44 a 48 ms). Lo único
 * que se ahorra es apagar TODAS las capas de OmniVision: ahí no se le pide nada.
 *
 * Sin base ni red: lo usan el visor y las pruebas.
 */
export type CapasVisibles = {
    persona: boolean; vehiculo: boolean; animal: boolean;
    /** Lo que detecta el modelo entrenado en OmniVision › Entrenar › Objetos. */
    propio: boolean;
    /** La matrícula dibujada sobre cada vehículo estacionado (sólo en el vivo). */
    chapas: boolean;
    /** Las zonas de las reglas, de los vigías y de la lectura (sólo en el vivo). Apagada de fábrica: tapa la escena. */
    zonas: boolean;
    /** La línea y la zona de la propia cámara. */
    camara: boolean;
};
export type ClaveCapa = keyof CapasVisibles;

export const CAPAS_DEFECTO: CapasVisibles = { persona: true, vehiculo: true, animal: true, propio: true, chapas: true, zonas: false, camara: true };
/** Las que salen del análisis de OmniVision cuadro a cuadro. */
export const CAPAS_DE_SILUETA: ClaveCapa[] = ["persona", "vehiculo", "animal", "propio"];
export const CLAVE_CAPAS = "oa.visor.capas";

/** Lo guardado en el navegador, con lo que falte (una capa nueva, un valor roto) de fábrica. */
export function leerCapas(texto: string | null | undefined): CapasVisibles {
    let g: unknown = null;
    try { g = texto ? JSON.parse(texto) : null; } catch { /* roto: de fábrica */ }
    const o = (g && typeof g === "object" ? g : {}) as Record<string, unknown>;
    const v = { ...CAPAS_DEFECTO };
    for (const k of Object.keys(v) as ClaveCapa[]) if (typeof o[k] === "boolean") v[k] = o[k] as boolean;
    return v;
}

/** ¿Hace falta pedirle el análisis a OmniVision? En la grabación las matrículas no cuentan: no hay. */
export const pideAnalisis = (v: CapasVisibles, conChapas = true) => CAPAS_DE_SILUETA.some((k) => v[k]) || (conChapas && v.chapas && !v.vehiculo);

/**
 * Lo que se dibuja de lo que vio el análisis. Un vehículo con la capa de vehículos apagada pero con
 * su matrícula a la vista queda como `oculto`: no se dibuja su silueta ni su rótulo, sólo su chapa.
 */
export function objetosVisibles<T extends { grupo: string; chapa?: unknown }>(objetos: T[], v: CapasVisibles): (T & { oculto?: boolean })[] {
    const out: (T & { oculto?: boolean })[] = [];
    for (const o of objetos) {
        const visible = o.grupo in v ? v[o.grupo as ClaveCapa] : true;
        if (visible) { if (v.chapas || o.chapa == null) out.push(o); else { const { chapa: _, ...sin } = o; void _; out.push(sin as T); } }
        else if (v.chapas && o.chapa != null) out.push({ ...o, oculto: true });
    }
    return out;
}
