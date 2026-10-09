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
 * Una inferencia son ~30 ms, pero el contenedor atiende de a una: si hay cola, se espera.
 * 15 s cubre el primer pedido en frío (~400 ms) y una cola larga sin dejar colgada la pantalla.
 */
const TIEMPO_DETECTAR_MS = 15000;

export type SaludVision = {
    ok: boolean; modelo: string; licencia: string; coco_ap: number; proveedor: string; resolucion: number;
    umbral_defecto: number; en_vuelo: number; esperando: number; total: number; errores: number;
    latencia_ms: { n: number; p50?: number; p95?: number }; tope_vram_mb: number;
    vram: { usada_mb: number; total_mb: number; uso_gpu: number } | null;
    modelos_disponibles: string[]; segundos_arriba: number;
};

export type ObjetoVisto = {
    clase: string; nombre: string; grupo: string; confianza: number;
    caja: [number, number, number, number]; caja_norm: [number, number, number, number];
    alternativa?: { clase: string; nombre: string; confianza: number };
};

export type ResultadoDeteccion = { ancho: number; alto: number; ms_inferencia: number; ms: number; modelo: string; umbral: number; objetos: ObjetoVisto[] };

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

export async function detectar(imagen: Buffer, umbral?: number): Promise<ResultadoDeteccion> {
    const q = umbral != null ? `?umbral=${umbral}` : "";
    const r = await fetch(`${VISION_URL()}/detectar${q}`, {
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
