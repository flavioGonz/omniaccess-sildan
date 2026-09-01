import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AccessDecision } from "@prisma/client";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        // Registro básico de evento para Avicam RF-2002f4
        // Payload típico de webhooks puede variar según configuración del dispositivo
        // Intentar deducir campos comunes como Mac o ID de dispositivo
        const deviceMac = body.mac || body.SN || body.SerialNumber;
        const eventType = body.type || body.eventType || 'FACE_DETECTION';
        const personId = body.id || body.personId || body.userId;
        const name = body.name || body.personName || 'Desconocido';

        // Buscar el dispositivo en DB por MAC para obtener el ID correcto
        let deviceId = null;
        if (deviceMac) {
            const device = await prisma.device.findFirst({
                where: {
                    OR: [
                        { mac: deviceMac },
                        { ip: req.nextUrl.hostname }
                    ]
                }
            });
            deviceId = device?.id;
        }

        // Registrar el evento de acceso en la base de datos
        // Usando prisma directly como el patrón sugerido por akuvox
        await prisma.accessEvent.create({
            data: {
                timestamp: new Date(),
                accessType: 'FACE',
                credentialId: personId?.toString() || null,
                userId: null, // Podría mapearse si personId existe en Users
                deviceId: deviceId,
                decision: 'GRANT', // Por ahora asumimos GRANT si llega el webhook
                details: JSON.stringify(body),
                location: 'Avicam Webhook'
            }
        });

        return NextResponse.json({ status: "received", success: true });
    } catch (error: any) {
        console.error("[Webhook Avicam Error]:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
