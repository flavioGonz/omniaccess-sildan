"use server";

import { relecturasDe, esNoLeida } from "@/lib/relectura";
import { prisma } from "@/lib/prisma";

/**
 * Doble verificación LPR para la consola de guardia: la relectura que hizo omni-vision de las
 * NO_LEIDA (vision-worker → tabla Relectura). Es una sugerencia; sin recortes (las imágenes de
 * vision van con sesión del panel).
 */
export type RelecturaGuardia = { plate: string | null; confianza: number | null; estado: string; quien: string | null; unidad: string | null; alerta: string | null };

export async function relecturasGuardia(ids: string[]): Promise<Record<string, RelecturaGuardia>> {
    const limpios = [...new Set((ids || []).filter((x) => typeof x === "string"))].slice(0, 200);
    if (!limpios.length) return {};
    const evs = await prisma.accessEvent.findMany({ where: { id: { in: limpios } }, select: { id: true, plateDetected: true } });
    const noLeidas = evs.filter((e) => esNoLeida(e.plateDetected)).map((e) => e.id);
    const mapa = await relecturasDe(noLeidas, () => "").catch(() => new Map());
    const out: Record<string, RelecturaGuardia> = {};
    for (const [id, r] of mapa) {
        out[id] = { plate: r.plate, confianza: r.confianza, estado: r.estado, quien: r.quien?.name || null, unidad: r.quien?.unidad || null, alerta: r.vigilancia?.label || null };
    }
    return out;
}
