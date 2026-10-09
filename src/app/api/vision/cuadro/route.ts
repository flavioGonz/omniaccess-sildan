import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const GO2RTC = process.env.GO2RTC_API || "http://127.0.0.1:1984";
const TIEMPO_CUADRO_MS = 8000;
const CUADRO_MIN_BYTES = 1000;

/**
 * GET /api/vision/cuadro?camara=<id> — el cuadro de este momento, del MISMO stream que mira
 * vision-worker (el substream de go2rtc). Lo usa el editor de reglas para dibujar la línea o
 * la zona: dibujarla sobre otra fuente (el snapshot ISAPI, con otro encuadre o proporción)
 * la dejaría corrida respecto de lo que analiza el worker.
 */
export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("No es una vista de pantalla.");
    const id = req.nextUrl.searchParams.get("camara") || "";
    const dev = await prisma.device.findUnique({ where: { id }, select: { id: true } });
    if (!dev) return NextResponse.json({ error: "No existe esa cámara" }, { status: 404 });
    for (const src of [`lpr_${dev.id}`, `lpr_${dev.id}_hd`]) {
        try {
            const r = await fetch(`${GO2RTC}/api/frame.jpeg?src=${encodeURIComponent(src)}`, { cache: "no-store", signal: AbortSignal.timeout(TIEMPO_CUADRO_MS) });
            if (!r.ok) continue;
            const b = Buffer.from(await r.arrayBuffer());
            if (b.length > CUADRO_MIN_BYTES) return new Response(new Uint8Array(b), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
        } catch { /* la siguiente fuente */ }
    }
    return NextResponse.json({ error: "go2rtc no entregó un cuadro de esa cámara" }, { status: 502 });
}
