import { leerAjuste } from "@/lib/ajustes-db";
import { CLAVE_ANALITICAS, CLAVE_CLASES, analiticasPorDefecto, clasesPorDefecto, mezclar } from "@/lib/vision-catalogo";

/**
 * Cliente de omni-vision (services/omni-vision), el contenedor de detección de objetos.
 *
 * Como omni-lpr: escucha sólo en localhost del CT, así que la URL es interna y viene del
 * entorno con el valor del despliegue por defecto.
 */
export const VISION_URL = () => (process.env.OMNI_VISION_URL || "http://127.0.0.1:8010").replace(/\/$/, "");

/** Lo que tarda en contestar /salud con la GPU libre es ~5 ms; 3 s ya es "no está". */
const TIEMPO_SALUD_MS = 3000;
/**
 * Una detección son ~30 ms, pero el contenedor atiende de a una: si hay cola, se espera. Y la
 * primera vez que se pide la pose o las siluetas el modelo se carga en la GPU (unos segundos).
 * 30 s cubre eso sin dejar colgada la pantalla para siempre.
 */
const TIEMPO_DETECTAR_MS = 30000;

export type SaludVision = {
    ok: boolean; modelo: string; licencia: string; coco_ap: number; proveedor: string; resolucion: number;
    umbral_defecto: number; en_vuelo: number; esperando: number; total: number; errores: number;
    latencia_ms: { n: number; p50?: number; p95?: number }; tope_vram_mb: number;
    vram: { usada_mb: number; total_mb: number; uso_gpu: number } | null;
    modelos_disponibles: string[]; segundos_arriba: number;
    tareas?: Record<string, EstadoTarea>; seguimiento?: { sesiones: number; licencia: string };
};

export type Atributo = {
    id: string; nombre: string; tipo: "uno" | "si_no"; valor: string; prob: number; dudoso: boolean;
    opciones: { valor: string; prob: number }[];
};

export type ObjetoVisto = {
    clase: string; nombre: string; grupo: string; confianza: number;
    caja: [number, number, number, number]; caja_norm: [number, number, number, number];
    alternativa?: { clase: string; nombre: string; confianza: number };
    /** Siluetas: polígonos normalizados (0-1) y fracción de la imagen que ocupa. */
    silueta?: [number, number][][]; area?: number;
    /** Pose: 17 puntos [x, y, visibilidad] normalizados, y la postura si se puede decir. */
    puntos?: [number, number, number][]; postura?: "de pie" | "agachada" | "acostada" | null; inclinacion?: number; motivo?: string;
    atributos?: Atributo[]; atributos_motivo?: string;
    /** Seguimiento: número de pista, o null mientras no se confirma. */
    pista?: number | null;
};

export type TareaVision = "detectar" | "segmentar" | "pose";

export type ResultadoDeteccion = {
    ancho: number; alto: number; ms_inferencia: number; ms: number; modelo: string; umbral: number;
    tarea: TareaVision; pasos: Record<string, number>; seguimiento: { cuadro: number; pistas_vistas: number } | null;
    objetos: ObjetoVisto[];
};

export type EstadoTarea = { modelo: string; licencia: string; abierto: boolean; proveedor: string | null; total: number; errores: number; latencia_ms: { n: number; p50?: number; p95?: number }; coco_ap?: number };

export async function saludVision(): Promise<{ salud: SaludVision | null; latencia: number; error?: string }> {
    const t0 = performance.now();
    try {
        const r = await fetch(`${VISION_URL()}/salud`, { cache: "no-store", signal: AbortSignal.timeout(TIEMPO_SALUD_MS) });
        if (!r.ok) return { salud: null, latencia: 0, error: `omni-vision respondió ${r.status}` };
        return { salud: await r.json(), latencia: Math.round(performance.now() - t0) };
    } catch (e: any) {
        return { salud: null, latencia: 0, error: e?.name === "TimeoutError" ? "omni-vision no contestó a tiempo" : "omni-vision no está corriendo" };
    }
}

export async function detectar(imagen: Buffer, op: { umbral?: number; tarea?: TareaVision; atributos?: boolean; sesion?: string; fps?: number } = {}): Promise<ResultadoDeteccion> {
    const q = new URLSearchParams();
    if (op.umbral != null) q.set("umbral", String(op.umbral));
    if (op.tarea) q.set("tarea", op.tarea);
    if (op.atributos) q.set("atributos", "1");
    if (op.sesion) { q.set("sesion", op.sesion); q.set("fps", String(op.fps || 2)); }
    const r = await fetch(`${VISION_URL()}/detectar?${q}`, {
        method: "POST", body: new Uint8Array(imagen), headers: { "content-type": "image/jpeg" },
        cache: "no-store", signal: AbortSignal.timeout(TIEMPO_DETECTAR_MS),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error || j?.detail || `omni-vision respondió ${r.status}`);
    return j as ResultadoDeteccion;
}

/** Los interruptores guardados, sobre los valores por defecto del catálogo. */
export async function leerInterruptores() {
    const [a, c] = await Promise.all([leerAjuste(CLAVE_ANALITICAS), leerAjuste(CLAVE_CLASES)]);
    const parse = (v?: string | null) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
    return {
        analiticas: mezclar(analiticasPorDefecto(), parse(a?.value)),
        clases: mezclar(clasesPorDefecto(), parse(c?.value)),
    };
}
