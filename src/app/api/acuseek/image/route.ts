/** GET /api/acuseek/image?u=<url del NVR> — proxya la imagen del NVR (digest) como jpeg. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchAcuSeekImage } from "@/lib/acuseek";

export async function GET(req: NextRequest) {
    const u = req.nextUrl.searchParams.get("u");
    if (!u) return new NextResponse("missing u", { status: 400 });
    try {
        const nvr = await prisma.device.findFirst({ where: { deviceType: "NVR" }, select: { ip: true, username: true, password: true, authType: true } });
        if (!nvr?.ip) return new NextResponse("no nvr", { status: 404 });
        // seguridad: solo imágenes del propio NVR
        const host = new URL(u).hostname;
        const nvrHost = nvr.ip.replace(/^https?:\/\//, "").split(":")[0];
        if (host !== nvrHost) return new NextResponse("forbidden host", { status: 403 });

        const { buf, contentType } = await fetchAcuSeekImage({ ip: nvr.ip, username: nvr.username || "admin", password: nvr.password || "", authType: nvr.authType || "DIGEST" }, u);
        return new NextResponse(buf, { status: 200, headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=3600" } });
    } catch (e: any) {
        return new NextResponse("image error", { status: 502 });
    }
}
