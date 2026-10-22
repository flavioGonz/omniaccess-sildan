/**
 * /api/centrales/ajustes — cómo se tratan los eventos de central (lib/centrales/tratamiento-tipos).
 *   GET → { cierres, procedimiento, escalado }        (con sesión)
 *   PUT { cierres? , procedimiento?, escalado?, restaurar?: "cierres" | "procedimiento" | "escalado" }
 *       sólo administrador; queda en Auditoría.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sesionCon, auditar } from "@/lib/centrales/sesion";
import { permisosDeSesion, esAdministrador } from "@/lib/permisos";
import { leerConfigTratamiento } from "@/lib/centrales/tratamiento";
import {
    AJUSTE_CIERRES, AJUSTE_ESCALADO, AJUSTE_PROCEDIMIENTO, CIERRES_DEFECTO, ESCALADO_DEFECTO, PROCEDIMIENTO_DEFECTO,
    leerCierres, leerEscalado, leerProcedimiento,
} from "@/lib/centrales/tratamiento-tipos";

export async function GET() {
    const { no } = await sesionCon(); if (no) return no;
    const c = await leerConfigTratamiento();
    return NextResponse.json({ ok: true, cierres: c.cierres, procedimiento: c.procedimiento, escalado: c.escalado }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest) {
    const { s, no } = await sesionCon(); if (no) return no;
    if (!esAdministrador(permisosDeSesion(s))) return NextResponse.json({ ok: false, error: "Esto lo cambia un administrador." }, { status: 403 });
    const b = await req.json().catch(() => ({}));
    const guardar = (key: string, value: unknown) => prisma.setting.upsert({ where: { key }, update: { value: JSON.stringify(value) }, create: { key, value: JSON.stringify(value) } });
    const hechos: string[] = [];
    if (b?.restaurar === "cierres" || b?.cierres) { await guardar(AJUSTE_CIERRES, b?.restaurar === "cierres" ? CIERRES_DEFECTO : leerCierres(b.cierres)); hechos.push("cierres"); }
    if (b?.restaurar === "procedimiento" || b?.procedimiento) { await guardar(AJUSTE_PROCEDIMIENTO, b?.restaurar === "procedimiento" ? PROCEDIMIENTO_DEFECTO : leerProcedimiento(b.procedimiento)); hechos.push("procedimiento"); }
    if (b?.restaurar === "escalado" || b?.escalado) { await guardar(AJUSTE_ESCALADO, b?.restaurar === "escalado" ? ESCALADO_DEFECTO : leerEscalado(b.escalado)); hechos.push("escalado"); }
    if (!hechos.length) return NextResponse.json({ ok: false, error: "Nada para guardar." }, { status: 400 });
    await auditar(s, "Cambió cómo se tratan los eventos de central", "Centrales de alarma", true, `${b?.restaurar ? "Restauró " : ""}${hechos.join(", ")}`);
    const c = await leerConfigTratamiento();
    return NextResponse.json({ ok: true, cierres: c.cierres, procedimiento: c.procedimiento, escalado: c.escalado });
}
