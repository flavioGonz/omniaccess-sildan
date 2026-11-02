/**
 * /api/centrales/eventos/<id>/verificacion — la video verificación del evento (lib/centrales/verificacion).
 *   GET  → las fotos del evento y de ahora, lo que vio OmniVision en cada una y el veredicto.
 *   POST → «Volver a verificar»: cuadros de ahora de las cámaras de la zona y otra vuelta de OmniVision.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { sesionCon } from "@/lib/centrales/sesion";
import { exigirFuncion } from "@/lib/funcion-servidor";
import { verificacionCentral, verificarAhora } from "@/lib/centrales/verificacion";

const ID = /^[\w-]{1,64}$/;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const funcionApagada = await exigirFuncion("FUNC_ALARMAS_GESTION"); if (funcionApagada) return funcionApagada;
    const { id } = await params;
    const { no } = await sesionCon(); if (no) return no;
    if (!ID.test(id)) return NextResponse.json({ ok: false, error: "Evento inválido" }, { status: 400 });
    const v = await verificacionCentral(id);
    if (!v) return NextResponse.json({ ok: false, error: "No es un evento de central" }, { status: 404 });
    return NextResponse.json({ ok: true, ...v }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const funcionApagada = await exigirFuncion("FUNC_ALARMAS_GESTION"); if (funcionApagada) return funcionApagada;
    const { id } = await params;
    const { s, no } = await sesionCon("hub.tratar"); if (no) return no;
    if (!ID.test(id)) return NextResponse.json({ ok: false, error: "Evento inválido" }, { status: 400 });
    const r = await verificarAhora(id, ((s as any)?.name as string) || ((s as any)?.sub as string) || null);
    return r.ok ? NextResponse.json(r) : NextResponse.json({ ok: false, error: r.error, sinCamaras: r.sinCamaras || undefined }, { status: r.status });
}
