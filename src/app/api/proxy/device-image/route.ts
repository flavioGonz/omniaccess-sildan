import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AkuvoxDriver } from "@/lib/drivers/AkuvoxDriver";
import { HikvisionDriver } from "@/lib/drivers/HikvisionDriver";

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const deviceId = searchParams.get("deviceId");
    const userId = searchParams.get("userId");
    const altId = searchParams.get("altId");
    const path = searchParams.get("path");
    const type = searchParams.get("type") || "face"; // face | snapshot | other

    if (!deviceId || (!userId && !path && type !== "snapshot")) {
        return new NextResponse("Missing params (deviceId + userId|path|type=snapshot required)", { status: 400 });
    }

    try {
        const device = await prisma.device.findUnique({ where: { id: deviceId } });
        if (!device) return new NextResponse("Device not found", { status: 404 });

        if (device.brand === 'AKUVOX') {
            const driver = new AkuvoxDriver();
            const imageBuffer = await driver.getFaceImage(device, userId, altId || undefined, path || undefined);
            if (!imageBuffer) return new NextResponse("Image not found", { status: 404 });
            return new NextResponse(imageBuffer as any, {
                headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" }
            });
        }

        if (device.brand === 'HIKVISION') {
            const driver = new HikvisionDriver();
            // For historical/log events the original frame is often not retrievable by an
            // arbitrary path, so we return a fresh channel snapshot (reliable via ISAPI).
            const buf = await driver.captureSnapshot(device);
            if (!buf) return new NextResponse("Image not found", { status: 404 });
            return new NextResponse(buf as any, {
                headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=30" }
            });
        }

        return new NextResponse("Brand not supported", { status: 400 });

    } catch (error: any) {
        console.error("Proxy Error:", error);
        return new NextResponse("Internal Error", { status: 500 });
    }
}
