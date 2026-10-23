/**
 * /api/centrales/ajustes — cómo se tratan los eventos de central (lib/centrales/tratamiento-tipos).
 *   GET → { cierres, procedimiento, procedimientosClase, escalado }        (con sesión)
 *   PUT { cierres? , procedimiento?, procedimientosClase?, escalado?, restaurar?: "cierres" | "procedimiento" | "escalado" }
 *       `procedimientosClase`: { ROBO: Paso[] | null, … } — null o ausente = usa el de su prioridad.
 *       pide «Configurar centrales» (hub.config); queda en Auditoría.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sesionCon, auditar } from "@/lib/centrales/sesion";
import { permisosDeSesion } from "@/lib/permisos";
import { leerConfigTratamiento } from "@/lib/centrales/tratamiento";
import {
    AJUSTE_CIERRES, AJUSTE_ESCALADO, AJUSTE_PROCEDIMIENTO, AJUSTE_PROCEDIMIENTOS_CLASE, CIERRES_DEFECTO, ESCALADO_DEFECTO, PROCEDIMIENTO_DEFECTO,
    leerCierres, leerEscalado, leerProcedimiento, leerProcedimientosClase,
} from "@/lib/centrales/tratamiento-tipos";
import { exigirFuncion } from "@/lib/funcion-servidor";

export async function GET() {
    const funcionApagada = await exigirFuncion("FUNC_ALARMAS_RECEPCION"); if (funcionApagada) return funcionApagada;
    const { no } = await sesionCon(); if (no) return no;
    const c = await leerConfigTratamiento();
    return NextResponse.json({ ok: true, cierres: c.cierres, procedimiento: c.procedimiento, procedimientosClase: c.procedimientosClase, escalado: c.escalado }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest) {
    const funcionApagada = await exigirFuncion("FUNC_ALARMAS_RECEPCION"); if (funcionApagada) return funcionApagada;
    const { s, no } = await sesionCon(); if (no) return no;
    if (!permisosDeSesion(s).includes("hub.config")) return NextResponse.json({ ok: false, error: "Hace falta el permiso Configurar centrales." }, { status: 403 });
    const b = await req.json().catch(() => ({}));
    const guardar = (key: string, value: unknown) => prisma.setting.upsert({ where: { key }, update: { value: JSON.stringify(value) }, create: { key, value: JSON.stringify(value) } });
    const hechos: string[] = [];
    if (b?.restaurar === "cierres" || b?.cierres) { await guardar(AJUSTE_CIERRES, b?.restaurar === "cierres" ? CIERRES_DEFECTO : leerCierres(b.cierres)); hechos.push("cierres"); }
    if (b?.restaurar === "procedimiento" || b?.procedimiento) { await guardar(AJUSTE_PROCEDIMIENTO, b?.restaurar === "procedimiento" ? PROCEDIMIENTO_DEFECTO : leerProcedimiento(b.procedimiento)); hechos.push("procedimiento"); }
    // Los de cada clase van con el de prioridad (la misma pantalla); restaurar los deja todos en «usa el de su prioridad».
    if (b?.restaurar === "procedimiento" || b?.procedimientosClase) { await guardar(AJUSTE_PROCEDIMIENTOS_CLASE, b?.restaurar === "procedimiento" ? {} : leerProcedimientosClase(b.procedimientosClase)); if (!hechos.includes("procedimiento")) hechos.push("procedimiento"); }
    if (b?.restaurar === "escalado" || b?.escalado) { await guardar(AJUSTE_ESCALADO, b?.restaurar === "escalado" ? ESCALADO_DEFECTO : leerEscalado(b.escalado)); hechos.push("escalado"); }
    if (!hechos.length) return NextResponse.json({ ok: false, error: "Nada para guardar." }, { status: 400 });
    await auditar(s, "Cambió cómo se tratan los eventos de central", "Centrales de alarma", true, `${b?.restaurar ? "Restauró " : ""}${hechos.join(", ")}`);
    const c = await leerConfigTratamiento();
    return NextResponse.json({ ok: true, cierres: c.cierres, procedimiento: c.procedimiento, procedimientosClase: c.procedimientosClase, escalado: c.escalado });
}
