"use server";

import { prisma } from "@/lib/prisma";

/**
 * ¿Hay al menos un NVR Hikvision I/VPro (soporta AcuSeek)?
 * Se usa para mostrar "Búsqueda inteligente" en el menú solo cuando aplica.
 * Match por modelo del device (ej. "DS-7732NXI-I4/VPro").
 */
export async function hasAcuSeekNvr(): Promise<boolean> {
    try {
        const n = await prisma.device.count({
            where: { deviceType: "NVR", deviceModel: { contains: "VPro", mode: "insensitive" } },
        });
        return n > 0;
    } catch {
        return false;
    }
}
