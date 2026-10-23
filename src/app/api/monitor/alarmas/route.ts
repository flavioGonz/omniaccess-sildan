import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor, SIN_CACHE } from "@/lib/monitor/servidor";
import { getActiveAlarms, getIntrusionesConfirmadas } from "@/app/actions/detections";
import { exigirFuncion } from "@/lib/funcion-servidor";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitor/alarmas → las alarmas de intrusión vigentes, para la alerta que se impone
 * sobre cualquier vista: las pendientes (nadie las aceptó) y las confirmadas sin resolver.
 */
export async function GET() {
    const funcionApagada = await exigirFuncion("FUNC_INTRUSION"); if (funcionApagada) return funcionApagada;
    const p = await autorizarMonitor("/api/monitor/alarmas");
    if (p.error) return p.error;
    const [pendientes, confirmadas] = await Promise.all([getActiveAlarms(), getIntrusionesConfirmadas()]);
    const ids = [...new Set(pendientes.map((a) => a.deviceId))];
    const devs = ids.length ? await prisma.device.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const nombre = Object.fromEntries(devs.map((d) => [d.id, d.name]));
    return NextResponse.json({
        pendientes: pendientes.map((a) => ({ ...a, deviceName: nombre[a.deviceId] || a.deviceId })),
        confirmadas,
        ahora: new Date().toISOString(),
    }, { headers: SIN_CACHE });
}
