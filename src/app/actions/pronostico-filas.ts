"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { pronosticoFila, type Pronostico } from "@/lib/filas/medidas";

/** Pronóstico, semana típica y calidad del dato de las filas (lib/filas/medidas). */
export async function getPronosticoFilas(deviceId?: string | null): Promise<Pronostico[]> {
    if (!(await getSession())) throw new Error("Necesitás iniciar sesión");
    const devices = await prisma.device.findMany({ where: { deviceType: "QUEUE_COUNTER", ...(deviceId ? { id: deviceId } : {}) }, select: { id: true }, orderBy: { name: "asc" } });
    return Promise.all(devices.map((d) => pronosticoFila(d.id)));
}
