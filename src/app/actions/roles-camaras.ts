"use server";

import { prisma } from "@/lib/prisma";
import { camarasVision } from "@/lib/vision-camaras";

/**
 * Lo que la lista de Dispositivos necesita para decir el ROL de cada cámara (lib/rol-camara):
 * qué cámaras nos avisan (las IPs con el servidor de alarma apuntando a OmniAccess, que el
 * endpoint alarm-host anota cada vez que lo mira o lo configura) y cuáles mira OmniVision.
 *
 * Antes la columna decía «Intrusión» si la cámara había mandado algo en los últimos 7 días: era
 * un dato de actividad con aspecto de configuración, y Perimetral 36 —armada igual que las otras
 * dos pero sin cruces— figuraba como «Cámara».
 */
export async function rolesDeCamaras(): Promise<{ avisan: string[]; vision: string[] }> {
    const fila = await prisma.setting.findUnique({ where: { key: "ALARM_CONFIGURED_IPS" } });
    let avisan: string[] = [];
    try { const l = JSON.parse(fila?.value || "[]"); avisan = Array.isArray(l) ? l.map(String) : []; } catch { avisan = []; }
    const { ids } = await camarasVision();
    return { avisan, vision: [...ids] };
}
