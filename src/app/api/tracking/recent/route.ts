import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/tracking/recent
 * Lo ultimo que leyo Omni-LPR en las camaras interiores. El monitor en vivo lo usa
 * para poner la matricula sobre cada baldosa, igual que hacen las camaras de acceso
 * con su evento. Se mira una ventana corta a proposito: si hace horas que no pasa un
 * auto, la baldosa queda limpia en vez de mostrar una lectura vieja como si fuera de ahora.
 */
export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    const desde = new Date(Date.now() - 30 * 60 * 1000);
    const filas = await prisma.plateSighting.findMany({
        where: { source: "TRACK", timestamp: { gte: desde } },
        orderBy: { timestamp: "desc" },
        take: 120,
        select: { id: true, plate: true, deviceId: true, cameraName: true, timestamp: true, confidence: true, snapshotUrl: true },
    });

    const porCamara: Record<string, any> = {};
    for (const f of filas) {
        if (f.deviceId && !porCamara[f.deviceId]) porCamara[f.deviceId] = f;
    }
    return NextResponse.json({ porCamara, ultimos: filas.slice(0, 20) });
}
