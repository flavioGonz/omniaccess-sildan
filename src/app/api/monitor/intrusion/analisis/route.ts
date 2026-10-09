import { NextRequest, NextResponse } from "next/server";
import { autorizarMonitor, SIN_CACHE } from "@/lib/monitor/servidor";
import { analizarDeteccion } from "@/lib/intrusion/analisis";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitor/intrusion/analisis?id=<detección> → los indicios alrededor de una
 * detección y el mapa con su cruce (lib/intrusion/analisis). Lo usan la ficha del panel y la
 * de la pared; cae dentro del alcance de la vista Intrusión y no escribe nada.
 */
export async function GET(req: NextRequest) {
    const p = await autorizarMonitor("/api/monitor/intrusion/analisis");
    if (p.error) return p.error;
    const id = req.nextUrl.searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "Falta la detección" }, { status: 400 });
    const a = await analizarDeteccion(id).catch(() => null);
    if (!a) return NextResponse.json({ error: "No se encontró la detección" }, { status: 404 });
    return NextResponse.json(a, { headers: SIN_CACHE });
}
