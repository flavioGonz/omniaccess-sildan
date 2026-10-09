/**
 * Cuánto pesa cada capacidad de visión en el hardware: VRAM, tiempo de GPU, CPU y RAM.
 *
 * Los números de las tareas que corren son MEDIDOS por omni-vision en esta placa (ver _paso en
 * services/omni-vision/app.py) y la app guarda el último (Setting VISION_MEDIDAS), así una
 * tarea que hoy no está cargada sigue mostrando lo que pesó la última vez. Las que no corren
 * (describir la escena, vocabulario abierto) llevan una ESTIMACIÓN por el tamaño del modelo, y
 * se dice que lo es: no se presenta como medido lo que nunca corrió acá.
 *
 * El puntaje (1 a 5) es para comparar de un vistazo, no para decidir: el detalle está al lado.
 */

export const CLAVE_MEDIDAS = "VISION_MEDIDAS";

export type Medida = { vram_mb?: number | null; ram_mb?: number | null; cpu_ms?: number | null; medido?: number | null; n?: number };

/** Qué tarea de omni-vision mide a cada capacidad del laboratorio. */
export const TAREA_DE_PESO: Record<string, string> = {
    deteccion: "detectar", segmentacion: "segmentar", pose: "pose", seguimiento: "seguimiento",
    clasificacion: "atributos", texto: "texto",
};

/**
 * Lo que no corre acá, estimado por el tamaño del modelo en fp16 y lo publicado para placas de
 * la clase de una RTX 3050. Rangos, no un número: así no parece una medición.
 */
export const ESTIMADOS: Record<string, { vram: [number, number]; ms: [number, number]; ram: [number, number]; modelo: string }> = {
    descripcion: { modelo: "SmolVLM2 500M / Florence-2 base", vram: [900, 1600], ms: [400, 1500], ram: [1200, 2000] },
    vocabulario: { modelo: "OWLv2 base / Grounding DINO tiny", vram: [800, 1500], ms: [150, 400], ram: [900, 1500] },
};

/**
 * Los tramos del puntaje. VRAM, sobre una placa de 6 GB que comparte con omni-lpr (~1 GB
 * propio): hasta 200 MB es casi nada; más de 1,5 GB ya es un cuarto de la placa. Tiempo de GPU
 * por cuadro: 10 ms a 4 c/s es el 4 % de la placa por cámara; 150 ms ya no deja seguir a más
 * de un par de cámaras en vivo.
 */
const TRAMOS_VRAM_MB = [200, 400, 800, 1500];
const TRAMOS_GPU_MS = [10, 25, 60, 150];
const tramo = (v: number, tramos: number[]) => tramos.findIndex((t) => v < t) + 1 || tramos.length + 1;

export const NOMBRE_PESO = ["", "Muy liviano", "Liviano", "Medio", "Pesado", "Muy pesado"];

/** El peso es el del recurso que más gasta: una tarea con poca VRAM y mucho tiempo de GPU es pesada igual. */
export function puntajePeso(vramMb: number | null | undefined, gpuMs: number | null | undefined): number | null {
    if (vramMb == null && gpuMs == null) return null;
    return Math.max(vramMb != null ? tramo(vramMb, TRAMOS_VRAM_MB) : 1, gpuMs != null ? tramo(gpuMs, TRAMOS_GPU_MS) : 1);
}

/** Los ritmos con que se da el ejemplo: el carril rápido (4 c/s) y la ronda (1 cuadro cada 2 s). */
export const RITMO_RAPIDO = 4;
export const RITMO_RONDA = 0.5;
/** Fracción de la GPU que ocupa una cámara a `fps` con `ms` por cuadro. */
export const fraccionGpu = (ms: number, fps: number) => (ms * fps) / 1000;

export const mb = (v: number) => (v >= 1024 ? `${(v / 1024).toFixed(1).replace(".", ",")} GB` : `${Math.round(v)} MB`);
export const porc = (f: number) => `${(f * 100).toFixed(f < 0.1 ? 1 : 0).replace(".", ",")} %`;
