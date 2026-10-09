import { prisma } from "@/lib/prisma";
import { getAnalyticsGeometryBatch } from "@/app/actions/detections";
import { verificacionesDe } from "@/lib/verificacion";
import type { Veredicto } from "@/lib/vision-capa";

/**
 * Doble verificación de los avisos de intrusión: la cámara dice «alguien cruzó» y omni-vision
 * mira la captura (vision-analisis.js). Una regla de notificación con verificacion="confirmada"
 * espera ese veredicto antes de avisar:
 *
 *  · Confirmada o «hay alguien» → avisa. «Hay alguien» también: la captura llega una fracción
 *    de segundo después del cruce y la persona puede estar ya del otro lado de la línea.
 *  · Sólo un animal, o nada → no avisa, y queda anotado (Detection.verifAviso = RETENIDO).
 *  · Si omni-vision no contesta en ESPERA_MAX_MS → avisa igual (SIN_VEREDICTO). Un aviso de más
 *    molesta; uno de menos, en seguridad, no se recupera.
 */
export const ESPERA_MAX_MS = 15_000;
const PASO_MS = 1_000;
/** El evento que llega a notificar y la Detection que guardó server.js pueden diferir unos segundos. */
const VENTANA_MS = 10_000;
/** Los veredictos que justifican despertar a alguien. */
export const AVISAN: Veredicto[] = ["CONFIRMADA", "PRESENTE"];

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function esperarVeredicto(ev: { deviceId?: string | null; evento: string; instante?: any }): Promise<{ detectionId: string | null; veredicto: Veredicto | null }> {
    if (!ev.deviceId) return { detectionId: null, veredicto: null };
    const t = ev.instante != null && !Number.isNaN(new Date(ev.instante).getTime()) ? new Date(ev.instante).getTime() : Date.now();
    const limite = Date.now() + ESPERA_MAX_MS;
    let id: string | null = null;
    while (Date.now() < limite) {
        const d = await prisma.detection.findFirst({
            where: { deviceId: ev.deviceId, type: ev.evento.toUpperCase(), timestamp: { gte: new Date(t - VENTANA_MS), lte: new Date(t + VENTANA_MS) } },
            orderBy: { timestamp: "desc" }, select: { id: true, verifAt: true, verifEstado: true },
        }).catch(() => null);
        if (d) id = d.id;
        if (d?.verifAt) {
            if (d.verifEstado !== "OK") return { detectionId: d.id, veredicto: null };
            const geom = await getAnalyticsGeometryBatch([ev.deviceId]).catch(() => ({}));
            const v = (await verificacionesDe([d.id], geom as any)).get(d.id);
            return { detectionId: d.id, veredicto: v?.veredicto ?? null };
        }
        await dormir(PASO_MS);
    }
    return { detectionId: id, veredicto: null };
}

export async function anotarAviso(detectionId: string | null, que: "ENVIADO" | "RETENIDO" | "SIN_VEREDICTO") {
    if (!detectionId) return;
    await prisma.detection.update({ where: { id: detectionId }, data: { verifAviso: que } }).catch(() => null);
}
