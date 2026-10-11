import { NextRequest, NextResponse } from "next/server";
import { grabacionesLpr, detectarGrabaciones, calcularRetencion, dondeGraba } from "@/app/actions/grabaciones";

export const dynamic = "force-dynamic";

/**
 * GET /api/devices/grabaciones                      -> NVR/canal/retencion de cada LPR
 * GET /api/devices/grabaciones?donde=<ip>            -> en que NVR/canal aparece esa IP (sin guardar)
 * POST /api/devices/grabaciones?accion=detectar      -> detecta y guarda en el mapa
 * POST /api/devices/grabaciones?accion=retencion&deviceId=...
 * (sesion del panel: lo exige el middleware y las acciones)
 */
export async function GET(req: NextRequest) {
    try {
        const ip = req.nextUrl.searchParams.get("donde");
        return NextResponse.json(ip ? await dondeGraba(ip) : await grabacionesLpr(), { headers: { "Cache-Control": "no-store" } });
    } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 401 }); }
}
export async function POST(req: NextRequest) {
    const accion = req.nextUrl.searchParams.get("accion");
    if (accion === "detectar") return NextResponse.json(await detectarGrabaciones());
    if (accion === "retencion") return NextResponse.json(await calcularRetencion(req.nextUrl.searchParams.get("deviceId") || ""));
    return NextResponse.json({ error: "accion invalida" }, { status: 400 });
}
