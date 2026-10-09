/**
 * Las reglas de las analíticas de visión: conteo por línea, sentido contrario, tiempo de
 * permanencia y aglomeración. Una regla es una cámara, una geometría (línea o zona) y unos
 * números; vision-worker (vision-reglas.js) las aplica sobre el seguimiento de cada cámara y
 * escribe lo que pasa en EventoVision.
 *
 * Viven en Setting VISION_REGLAS (JSON). Este archivo no habla con la base: lo usan la
 * pantalla /admin/vision/reglas y su ruta. El worker, que no compila TypeScript, repite la
 * validación mínima (si cambia algo acá, cambia allá).
 *
 * Geometría en fracciones del cuadro entero (0-1, origen arriba a la izquierda), igual que
 * las cajas de omni-vision. Lo que se mira de cada objeto es el PIE de su caja (centro del
 * borde de abajo): es donde el objeto toca el piso, y lo que cruza una línea dibujada en el
 * piso es el pie, no la cabeza.
 *
 * Los dos lados de una línea a→b: B es el lado hacia donde apunta la normal (-(by-ay), bx-ax)
 * —en pantalla, a la derecha del sentido a→b— y A el otro. «ab» es pasar del lado A al lado B.
 */

export const CLAVE_REGLAS = "VISION_REGLAS";

export type TipoRegla = "conteo" | "sentido" | "permanencia" | "aglomeracion";
export type Punto = [number, number];
export type Sentido = "ab" | "ba";

export type ReglaVision = {
    id: string;
    tipo: TipoRegla;
    deviceId: string;
    nombre: string;
    activa: boolean;
    /** Conteo y sentido: la línea en el piso. */
    linea?: { a: Punto; b: Punto } | null;
    /** Sentido: el sentido PERMITIDO; el otro es el contrario. */
    permitido?: Sentido;
    /** Permanencia (obligatoria) y aglomeración (opcional: sin zona es el cuadro entero). */
    zona?: Punto[] | null;
    /** Clases COCO que cuentan (person, car, truck, bus, motorcycle, bicycle, dog…). */
    clases: string[];
    /** Permanencia: desde cuántos segundos adentro avisa. Aglomeración: cuánto tiene que durar. */
    segundos?: number;
    /** Aglomeración: desde cuántas personas a la vez. */
    maximo?: number;
    /** Si además de registrarlo crea un aviso a la guardia (consola, Control LPR, Visitas). */
    avisar: boolean;
};

/** Qué es cada tipo, qué analítica del laboratorio lo prende y qué geometría pide. */
export const TIPOS_REGLA: Record<TipoRegla, {
    nombre: string; analitica: string; geometria: "linea" | "zona"; queHace: string;
    clasesDefecto: string[]; avisarDefecto: boolean; segundosDefecto?: number; maximoDefecto?: number;
}> = {
    conteo: {
        nombre: "Conteo por línea", analitica: "aforo", geometria: "linea",
        queHace: "Cuenta lo que cruza la línea, en cada sentido y por clase. Cada objeto se cuenta una vez por cruce.",
        clasesDefecto: ["person", "car", "truck", "bus", "motorcycle", "bicycle"], avisarDefecto: false,
    },
    sentido: {
        nombre: "Sentido contrario", analitica: "sentido-contrario", geometria: "linea",
        queHace: "Avisa cuando algo cruza la línea en el sentido que no corresponde (la mano contraria de una calle, la salida usada como entrada).",
        clasesDefecto: ["car", "truck", "bus", "motorcycle"], avisarDefecto: true,
    },
    permanencia: {
        nombre: "Tiempo de permanencia", analitica: "permanencia", geometria: "zona",
        queHace: "Avisa cuando una persona o un vehículo se queda en la zona más de lo indicado, y registra cuánto se quedó en total.",
        clasesDefecto: ["person", "car", "truck"], avisarDefecto: true, segundosDefecto: 300,
    },
    aglomeracion: {
        nombre: "Aglomeración", analitica: "aglomeracion", geometria: "zona",
        queHace: "Avisa cuando hay más personas juntas de lo indicado en la zona (o en todo el cuadro), durante un rato.",
        clasesDefecto: ["person"], avisarDefecto: true, segundosDefecto: 30, maximoDefecto: 5,
    },
};

/** Las clases que se ofrecen en una regla, con su nombre en castellano. */
export const CLASES_REGLA: { clase: string; nombre: string }[] = [
    { clase: "person", nombre: "Personas" },
    { clase: "car", nombre: "Autos" },
    { clase: "truck", nombre: "Camionetas y camiones" },
    { clase: "bus", nombre: "Ómnibus" },
    { clase: "motorcycle", nombre: "Motos" },
    { clase: "bicycle", nombre: "Bicicletas" },
    { clase: "dog", nombre: "Perros" },
];
export const NOMBRE_CLASE_REGLA: Record<string, string> = Object.fromEntries(CLASES_REGLA.map((c) => [c.clase, c.nombre]));

/** Topes para que un número mal escrito no deje una regla inútil o peligrosa. */
const SEGUNDOS = { min: 5, max: 6 * 3600 };
const MAXIMO = { min: 2, max: 200 };

const fr = (v: unknown) => Math.max(0, Math.min(1, Number(v)));
const punto = (p: unknown): Punto | null => (Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])) ? [fr(p[0]), fr(p[1])] : null);

/** Valida y limpia una lista de reglas. Devuelve las válidas y por qué se descartó cada otra. */
export function validarReglas(x: unknown): { reglas: ReglaVision[]; errores: string[] } {
    const out: ReglaVision[] = [];
    const errores: string[] = [];
    for (const r of Array.isArray(x) ? x : []) {
        const tipo = String(r?.tipo) as TipoRegla;
        const t = TIPOS_REGLA[tipo];
        const nombre = String(r?.nombre || "").trim().slice(0, 80) || (t ? t.nombre : "Regla");
        if (!t) { errores.push(`${nombre}: tipo desconocido`); continue; }
        if (!r?.deviceId) { errores.push(`${nombre}: falta la cámara`); continue; }
        const regla: ReglaVision = {
            id: String(r.id || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || Math.random().toString(36).slice(2, 12),
            tipo, deviceId: String(r.deviceId), nombre, activa: r.activa !== false,
            clases: (Array.isArray(r.clases) ? r.clases : t.clasesDefecto).map(String).filter((c: string) => /^[a-z ]+$/.test(c)).slice(0, 20),
            avisar: typeof r.avisar === "boolean" ? r.avisar : t.avisarDefecto,
        };
        if (!regla.clases.length) { errores.push(`${nombre}: elegí al menos una clase`); continue; }
        if (t.geometria === "linea") {
            const a = punto(r?.linea?.a), b = punto(r?.linea?.b);
            if (!a || !b || Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.03) { errores.push(`${nombre}: la línea necesita dos puntos separados`); continue; }
            regla.linea = { a, b };
            if (tipo === "sentido") regla.permitido = r?.permitido === "ba" ? "ba" : "ab";
        } else {
            const zona = (Array.isArray(r?.zona) ? r.zona : []).map(punto).filter(Boolean) as Punto[];
            if (tipo === "permanencia" && zona.length < 3) { errores.push(`${nombre}: la zona necesita al menos 3 puntos`); continue; }
            regla.zona = zona.length >= 3 ? zona.slice(0, 30) : null;
            regla.segundos = Math.round(Math.max(SEGUNDOS.min, Math.min(SEGUNDOS.max, Number(r?.segundos) || t.segundosDefecto || 60)));
            if (tipo === "aglomeracion") regla.maximo = Math.round(Math.max(MAXIMO.min, Math.min(MAXIMO.max, Number(r?.maximo) || t.maximoDefecto || 5)));
        }
        out.push(regla);
    }
    return { reglas: out, errores };
}

/** Los tipos de evento que escribe el worker, con su rótulo. */
export const TIPOS_EVENTO: Record<string, { nombre: string; tono: "info" | "mal" | "aviso" | "quieto" }> = {
    CRUCE: { nombre: "Cruce", tono: "quieto" },
    SENTIDO_CONTRARIO: { nombre: "Sentido contrario", tono: "mal" },
    PERMANENCIA: { nombre: "Permanencia", tono: "aviso" },
    AGLOMERACION: { nombre: "Aglomeración", tono: "aviso" },
};

/** «2 min 30 s», «1 h 5 min». */
export function duracionCorta(seg: number | null | undefined): string {
    const s = Math.max(0, Math.round(Number(seg) || 0));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min${s % 60 ? ` ${s % 60} s` : ""}`;
    return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}
