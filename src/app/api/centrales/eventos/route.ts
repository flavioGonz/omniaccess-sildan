/**
 * GET /api/centrales/eventos — los eventos de central sin tratar (lib/centrales/tratamiento), para la
 * ventana que salta en todo el panel y la pila de avisos. Trae también lo que hace falta para
 * tratarlos: el catálogo de cierres, el procedimiento y hasta qué prioridad salta la ventana.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { sesionCon } from "@/lib/centrales/sesion";
import { eventosPendientes, leerConfigTratamiento } from "@/lib/centrales/tratamiento";
import { exigirFuncion } from "@/lib/funcion-servidor";


export async function GET() {
    const funcionApagada = await exigirFuncion("FUNC_ALARMAS_GESTION"); if (funcionApagada) return funcionApagada;
    const { s, no } = await sesionCon(); if (no) return no;
    try {
        const yo = (s?.name as string) || (s?.sub as string) || null;
        const [eventos, cfg] = await Promise.all([eventosPendientes(yo), leerConfigTratamiento()]);
        return NextResponse.json({ ok: true, yo, eventos, cierres: cfg.cierres.filter((c) => c.activo), procedimiento: cfg.procedimiento, escalado: cfg.escalado }, { headers: { "Cache-Control": "no-store" } });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "No se pudieron leer los eventos." }, { status: 500 });
    }
}
