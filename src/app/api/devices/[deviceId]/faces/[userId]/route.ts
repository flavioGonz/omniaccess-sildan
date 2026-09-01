import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import axios from "axios";
import https from "https";

const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ deviceId: string; userId: string }> }
) {
    try {
        const { deviceId, userId } = await params;

        const device = await prisma.device.findUnique({
            where: { id: deviceId },
        });

        if (!device) {
            return new NextResponse("Device not found", { status: 404 });
        }

        if (device.brand !== 'AKUVOX') {
            return new NextResponse("Not an Akuvox device", { status: 400 });
        }

        // URL del dispositivo
        const deviceUrl = `http://${device.ip}/api/face/get?ID=${userId}`;

        // Configurar autenticación Basic
        let headers: any = {};
        if (device.username && device.password) {
            const auth = Buffer.from(`${device.username}:${device.password}`).toString('base64');
            headers['Authorization'] = `Basic ${auth}`;
        }

        // Solicitar la imagen al dispositivo
        const response = await axios.get(deviceUrl, {
            responseType: 'arraybuffer',
            headers: headers,
            httpsAgent: httpsAgent,
            timeout: 5000
        });

        // Devolver la imagen al navegador
        const contentType = response.headers['content-type'] || 'image/jpeg';

        return new NextResponse(response.data, {
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=3600'
            },
        });

    } catch (error: any) {
        console.error("[ProxyFace] Error fetching face:", error.message);
        return new NextResponse("Error fetching image", { status: 500 });
    }
}
