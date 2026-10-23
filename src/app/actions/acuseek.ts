"use server";

import { prisma } from "@/lib/prisma";

/**
 * ¿Hay al menos un grabador con búsqueda AcuSeek/AcuSearch? Se usa para mostrar «Búsqueda
 * inteligente» y el motor del NVR en Buscar parecidos sólo cuando aplica.
 *
 * Miraba sólo el modelo guardado («…/VPro»), y un NVR recién dado de alta no tiene modelo hasta
 * que se «Comprueba»: el VPro de Otto Villa no habilitaba nada (21/10). Ahora, si el modelo no lo
 * dice, se le pregunta a los grabadores (lib/acuseek-nvr, cacheado).
 */
export async function hasAcuSeekNvr(): Promise<boolean> {
    try {
        const n = await prisma.device.count({ where: { deviceType: "NVR", deviceModel: { contains: "VPro", mode: "insensitive" } } });
        if (n > 0) return true;
        const { nvrConAcuSeek } = await import("@/lib/acuseek-nvr");
        return !!(await nvrConAcuSeek("imagen"));
    } catch {
        return false;
    }
}
