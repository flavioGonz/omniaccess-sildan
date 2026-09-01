
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AkuvoxDriver } from "@/lib/drivers/AkuvoxDriver";

export async function GET() {
    try {
        const device = await prisma.device.findFirst({ where: { brand: 'AKUVOX' } });
        if (!device) return NextResponse.json({ error: "No AKUVOX device found in DB" });

        const driver = new AkuvoxDriver();

        // Call user/get
        const userRes = await (driver as any).request("POST", "/api/user/get",
            { "target": "user", "action": "get", "data": { "offset": 0, "num": 100 } },
            device
        );

        // Call face/list
        const faceRes = await (driver as any).request("POST", "/api/face/list",
            { "target": "face", "action": "list", "data": { "offset": 0, "num": 100 } },
            device
        );

        return NextResponse.json({
            deviceIp: device.ip,
            users: userRes?.data?.item?.slice(0, 5) || [],
            faces: faceRes?.data?.item?.slice(0, 5) || [],
            rawUser: userRes,
            rawFace: faceRes
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message, stack: e.stack });
    }
}
