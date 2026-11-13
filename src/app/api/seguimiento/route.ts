/**
 * GET /api/seguimiento?plate=SCH1707&dias=7 — «Seguirlo»: dónde está una matrícula o cuándo se
 * fue, y su recorrido (lib/seguimiento-chapa). Sólo lee. Con sesión del panel o enlace de pantalla.
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { seguimientoDeChapa } from "@/lib/seguimiento-chapa-servidor";

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    const r = await seguimientoDeChapa(req.nextUrl.searchParams.get("plate") || "", Number(req.nextUrl.searchParams.get("dias")) || undefined)
        .catch((e) => { console.error("[seguimiento]", e?.message || e); return undefined; });
    if (r === undefined) return NextResponse.json({ error: "No se pudo armar el seguimiento." }, { status: 500 });
    if (r === null) return NextResponse.json({ error: "Falta la matrícula." }, { status: 400 });
    return NextResponse.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
}
