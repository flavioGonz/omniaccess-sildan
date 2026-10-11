import { prisma } from "@/lib/prisma";
import { geomDeIntrusion, veredicto, ORDEN_VEREDICTO, type Analisis, type Veredicto } from "@/lib/vision-capa";

/**
 * La verificación de omni-vision de unas detecciones de intrusión, con su veredicto calculado
 * con la geometría VIGENTE de cada cámara: lo guardado es lo que se vio (vision-analisis.js), la
 * conclusión depende de dónde está hoy la línea.
 */
export type Verificacion = {
    estado: string | null; veredicto: Veredicto | null; analisis: Analisis | null; tocan: boolean[];
    /** El cuadro propio (doble verificación): su veredicto y los segundos después del evento. */
    propio: { veredicto: Veredicto; despuesS: number } | null;
    /** De dónde sale el veredicto final: la captura de la cámara o el cuadro propio, el más fuerte. */
    fuente: "captura" | "propio" | null;
    aviso: string | null;
};

export async function verificacionesDe(ids: string[], geomPorCamara: Record<string, any>): Promise<Map<string, Verificacion>> {
    const out = new Map<string, Verificacion>();
    const unicos = [...new Set(ids.filter(Boolean))];
    if (!unicos.length) return out;
    /* Olivos no tiene omni-vision (sin GPU): las detecciones no traen verificacion. */
    return out;
}
