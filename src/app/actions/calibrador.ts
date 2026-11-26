"use server";

import { prisma } from "@/lib/prisma";
import { getImagePath } from "@/lib/image-path";

/**
 * Las últimas capturas de una cámara, para la pila del calibrador (26/11).
 *
 * Nico: «el calibrador, en vivo, deberá tener las últimas capturas que realizó, apiladas a la
 * derecha del video». Al abrir, la pila no puede arrancar vacía esperando un auto: se llena con
 * lo último que se leyó en esa cámara y, desde ahí, las lecturas en vivo se apilan arriba.
 *
 * Sólo lo que hace falta para mirarlas: la chapa, la hora, la confianza y la foto. La foto va
 * como ruta de la aplicación; el navegador la pide con su sesión.
 */
export async function ultimasCapturas(deviceId: string, cuantas = 12) {
    const { getSession } = await import("@/app/actions/auth");
    if (!(await getSession())) return [];
    const n = Math.max(1, Math.min(24, Math.floor(cuantas) || 12));
    const filas = await prisma.plateSighting.findMany({
        where: { deviceId, snapshotUrl: { not: null } },
        orderBy: { timestamp: "desc" },
        take: n,
        select: { id: true, plate: true, confidence: true, timestamp: true, snapshotUrl: true, source: true, eventType: true },
    });
    return filas.map((f) => ({
        id: f.id, plate: f.plate, confianza: f.confidence ?? null,
        ts: f.timestamp.toISOString(), foto: getImagePath(f.snapshotUrl),
        fuente: f.source === "TRACK" ? "omni-lpr" : "cámara", tipo: f.eventType || null,
    }));
}
