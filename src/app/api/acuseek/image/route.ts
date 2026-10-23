/** GET /api/acuseek/image?u=<url del NVR> — proxya la imagen del NVR (digest) como jpeg. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { fetchAcuSeekImage } from "@/lib/acuseek";
import { nvrPorHost, conSesion } from "@/lib/acuseek-nvr";

export async function GET(req: NextRequest) {
    const no = await conSesion(); if (no) return no;
    const u = req.nextUrl.searchParams.get("u");
    if (!u) return new NextResponse("missing u", { status: 400 });
    try {
        // Sólo imágenes de un grabador nuestro con AcuSearch: el dueño se elige por el host de la URL
        // (texto e imagen pueden ir a grabadores distintos).
        const nvr = (await nvrPorHost(new URL(u).hostname))?.dev;
        if (!nvr?.ip) return new NextResponse("forbidden host", { status: 403 });

        const { buf, contentType } = await fetchAcuSeekImage(nvr, u);
        return new NextResponse(new Uint8Array(buf), { status: 200, headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600" } });
    } catch (e: any) {
        return new NextResponse("image error", { status: 502 });
    }
}
