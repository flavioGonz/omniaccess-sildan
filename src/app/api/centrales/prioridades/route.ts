/**
 * /api/centrales/prioridades — la prioridad de cada clase de evento de las centrales (lib/centrales/prioridades).
 *   GET  → { prioridades, clases, niveles }            (cualquiera con sesión: la pantalla las muestra)
 *   PUT  { prioridades: { ROBO: 1, … } } | { restaurar: true }   (sólo administrador, queda en Auditoría)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sesionCon, auditar } from "@/lib/centrales/sesion";
import { permisosDeSesion, esAdministrador } from "@/lib/permisos";
import { AJUSTE_PRIORIDADES, CLASES, NIVELES, leerPrioridades, PRIORIDADES_DEFECTO } from "@/lib/centrales/prioridades";
import { leerPrioridadesGuardadas } from "@/lib/centrales/prioridades-servidor";
import { exigirFuncion } from "@/lib/funcion-servidor";

export async function GET() {
    const funcionApagada = await exigirFuncion("FUNC_ALARMAS_RECEPCION"); if (funcionApagada) return funcionApagada;
    const { no } = await sesionCon(); if (no) return no;
    return NextResponse.json({ ok: true, prioridades: await leerPrioridadesGuardadas(), clases: CLASES, niveles: NIVELES }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest) {
    const funcionApagada = await exigirFuncion("FUNC_ALARMAS_RECEPCION"); if (funcionApagada) return funcionApagada;
    const { s, no } = await sesionCon(); if (no) return no;
    if (!esAdministrador(permisosDeSesion(s))) return NextResponse.json({ ok: false, error: "Las prioridades las cambia un administrador." }, { status: 403 });
    const b = await req.json().catch(() => ({}));
    const nuevas = b?.restaurar ? PRIORIDADES_DEFECTO : leerPrioridades(b?.prioridades);
    const antes = await leerPrioridadesGuardadas();
    await prisma.setting.upsert({ where: { key: AJUSTE_PRIORIDADES }, update: { value: JSON.stringify(nuevas) }, create: { key: AJUSTE_PRIORIDADES, value: JSON.stringify(nuevas) } });
    const cambios = CLASES.filter((c) => antes[c.clase] !== nuevas[c.clase]).map((c) => `${c.nombre} ${antes[c.clase]}→${nuevas[c.clase]}`);
    await auditar(s, "Cambió las prioridades de las centrales", "Centrales de alarma", true, b?.restaurar ? "Restauró las de fábrica" : cambios.join(", ") || "sin cambios");
    return NextResponse.json({ ok: true, prioridades: nuevas });
}
