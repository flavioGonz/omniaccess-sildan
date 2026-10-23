/** GET /api/grabador/imagen?nvr=<id>&u=<url del grabador> — la imagen de un resultado, con la autenticación del grabador. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { conSesion } from "@/lib/acuseek-nvr";
import { grabadorPorId, driverDe } from "@/lib/grabador-busqueda";

export async function GET(req: NextRequest) {
    const no = await conSesion(); if (no) return no;
    const id = req.nextUrl.searchParams.get("nvr") || "", u = req.nextUrl.searchParams.get("u") || "";
    const gr = await grabadorPorId(id);
    const d = gr ? driverDe(gr.marca) : null;
    if (!gr || !d || !u) return new NextResponse("no", { status: 404 });
    // Sólo imágenes de ESE grabador: la URL tiene que apuntar a su IP.
    try { if (new URL(u).hostname !== gr.c.ip.replace(/^https?:\/\//, "").split(":")[0]) return new NextResponse("forbidden host", { status: 403 }); }
    catch { return new NextResponse("bad url", { status: 400 }); }
    try {
        const { buf, tipo } = await d.imagen(gr.c, u);
        return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": tipo, "Cache-Control": "private, max-age=3600" } });
    } catch { return new NextResponse("image error", { status: 502 }); }
}
