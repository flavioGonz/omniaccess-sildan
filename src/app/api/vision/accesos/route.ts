import { NextRequest, NextResponse } from "next/server";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { resumenAccesos } from "@/lib/accesos-vision";

export const dynamic = "force-dynamic";

const RANGOS_H = new Set([24, 168]);

/** GET /api/vision/accesos?h=24|168 — los pasos por la línea de conteo de cada acceso, contra sus lecturas (lib/accesos-vision). */
export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("No es una vista de pantalla.");
    const hq = Number(req.nextUrl.searchParams.get("h"));
    const h = RANGOS_H.has(hq) ? hq : 24;
    try {
        return NextResponse.json({ h, accesos: await resumenAccesos(h) }, { headers: { "Cache-Control": "no-store" } });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "No se pudo contar" }, { status: 500 });
    }
}
