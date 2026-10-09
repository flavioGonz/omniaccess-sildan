import { prisma } from "@/lib/prisma";
import { geomDeIntrusion, veredicto, type Analisis, type Veredicto } from "@/lib/vision-capa";

/**
 * La verificación de omni-vision de unas detecciones de intrusión, con su veredicto calculado
 * con la geometría VIGENTE de cada cámara: lo guardado es lo que se vio (vision-analisis.js), la
 * conclusión depende de dónde está hoy la línea.
 */
export type Verificacion = { estado: string | null; veredicto: Veredicto | null; analisis: Analisis | null; tocan: boolean[] };

export async function verificacionesDe(ids: string[], geomPorCamara: Record<string, any>): Promise<Map<string, Verificacion>> {
    const out = new Map<string, Verificacion>();
    const unicos = [...new Set(ids.filter(Boolean))];
    if (!unicos.length) return out;
    const filas = await prisma.detection.findMany({ where: { id: { in: unicos }, verifAt: { not: null } }, select: { id: true, deviceId: true, verifEstado: true, verifAnalisis: true } }).catch(() => []);
    for (const f of filas) {
        const a = (f.verifEstado === "OK" ? f.verifAnalisis : null) as Analisis | null;
        const g = f.deviceId ? geomDeIntrusion(geomPorCamara[f.deviceId]) : null;
        const v = a ? veredicto(a, g) : null;
        out.set(f.id, { estado: f.verifEstado, veredicto: v?.estado ?? null, analisis: a, tocan: v?.tocan ?? [] });
    }
    return out;
}
