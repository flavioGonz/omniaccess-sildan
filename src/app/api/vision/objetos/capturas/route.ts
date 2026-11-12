import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { puedeMirar, puedeCambiar } from "@/lib/zona-entrenable-servidor";
import { nombresDeCamaras } from "@/lib/detector-propio-servidor";
import { listarProgramas } from "@/lib/capturas-programadas-servidor";
import { validarPrograma } from "@/lib/capturas-programadas";

export const dynamic = "force-dynamic";

/**
 * Las programaciones de capturas para el conjunto de entrenamiento (openspec
 * capturas-programadas-entrenamiento).
 * GET  — todas, con su situación, sus cámaras, lo que queda sin dibujar y si el reloj está pasando.
 * POST — crear una: { nombre, camaras[], cadaMin, horario?, tope, hasta }.
 */
export async function GET() {
    const e = await puedeMirar(); if (e) return e;
    return NextResponse.json(await listarProgramas(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
    const { error, quien } = await puedeCambiar(); if (error) return error;
    const v = validarPrograma(await req.json().catch(() => ({})));
    if ("error" in v) return NextResponse.json({ error: v.error }, { status: 400 });
    const existen = await nombresDeCamaras(v.datos.camaras);
    const faltan = v.datos.camaras.filter((c) => !existen.has(c));
    if (faltan.length) return NextResponse.json({ error: faltan.length === 1 ? "Una de las cámaras ya no existe." : `${faltan.length} de las cámaras ya no existen.` }, { status: 400 });
    // Nace con la primera vuelta ya pendiente: se ve andar en el minuto, no dentro de media hora.
    const p = await prisma.capturaProgramada.create({ data: { ...v.datos, horario: v.datos.horario ?? undefined, creadaPor: quien } });
    return NextResponse.json({ id: p.id });
}
