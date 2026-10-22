/** GET /api/centrales/eventos/informe?h=168 — tiempos de toma y tratamiento por operador (medianas). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { sesionCon } from "@/lib/centrales/sesion";
import { informeTiempos } from "@/lib/centrales/tratamiento";

export async function GET(req: NextRequest) {
    const { no } = await sesionCon(); if (no) return no;
    const h = [24, 72, 168, 720].includes(Number(req.nextUrl.searchParams.get("h"))) ? Number(req.nextUrl.searchParams.get("h")) : 168;
    return NextResponse.json({ ok: true, horas: h, ...(await informeTiempos(h)) }, { headers: { "Cache-Control": "no-store" } });
}
