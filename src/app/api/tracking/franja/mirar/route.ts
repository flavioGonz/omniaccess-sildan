import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mirarLaFranja } from "@/lib/ocupaciones";

export const dynamic = "force-dynamic";

/**
 * POST /api/tracking/franja/mirar  { deviceId }
 *
 * Mirar la franja AHORA, porque la cámara acaba de avisar que algo entró en su zona.
 *
 * El barrido de cada minuto alcanza para no perder un auto, pero no para que el panel
 * acompañe lo que el guardia está viendo por la ventana: si un auto estaciona justo después
 * de una vuelta, aparece hasta un minuto más tarde. Las Hikvision y las Dahua del barrio ya
 * clasifican intrusión de vehículo en el propio equipo, así que ese aviso sale gratis y
 * sirve para adelantar la mirada.
 *
 * Lo que NO hace es decidir por la cámara. La ocupación se sigue midiendo acá, por dos
 * razones: la analítica del equipo informa sus regiones con `enabled=false` aunque la regla
 * esté andando —ya nos hizo perder una tarde—, y las cámaras RTSP genéricas no tienen nada
 * de esto. El aviso adelanta el reloj; el criterio es siempre el mismo.
 */
export async function POST(req: NextRequest) {
    const token = req.headers.get("x-tracking-token") || "";
    let esperado = process.env.TRACKING_TOKEN || "";
    if (!esperado) {
        const s = await prisma.setting.findUnique({ where: { key: "TRACKING_TOKEN" } });
        esperado = s?.value || "";
    }
    if (!esperado || token !== esperado) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const body = await req.json().catch(() => ({} as any));
    const deviceId = String(body?.deviceId || "");
    if (!deviceId) return NextResponse.json({ error: "Falta deviceId" }, { status: 400 });

    const equipo = await prisma.device.findUnique({
        where: { id: deviceId },
        select: { id: true, name: true, rtspUrl: true },
    });
    if (!equipo) return NextResponse.json({ error: "No existe ese equipo" }, { status: 404 });

    return NextResponse.json(await mirarLaFranja(equipo));
}
