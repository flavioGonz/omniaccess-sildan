import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { puedeCambiar } from "@/lib/zona-entrenable-servidor";
import { nombresDeCamaras } from "@/lib/detector-propio-servidor";
import { validarPrograma } from "@/lib/capturas-programadas";

export const dynamic = "force-dynamic";

/**
 * PUT — una acción o una edición:
 *   { accion: "pausar" | "reanudar" | "tomar" }   pausar conserva contadores, tope y fecha; «tomar»
 *                                                 deja el pedido y el reloj lo toma en su próxima pasada.
 *   { nombre, camaras[], cadaMin, horario?, tope, hasta }   editar. Si con los valores nuevos ya no
 *                                                 está terminada (se subió el tope o se corrió la fecha), sigue.
 * DELETE — borra la programación. Sus fotos quedan en el conjunto (ver …/fotos para descartarlas).
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { error } = await puedeCambiar(); if (error) return error;
    const { id } = await params;
    const p = await prisma.capturaProgramada.findUnique({ where: { id } });
    if (!p) return NextResponse.json({ error: "No existe esa programación" }, { status: 404 });
    const b = await req.json().catch(() => ({}));

    if (b?.accion === "pausar") {
        await prisma.capturaProgramada.update({ where: { id }, data: { activa: false, forzarAt: null } });
        return NextResponse.json({ ok: true });
    }
    if (b?.accion === "reanudar") {
        // Vuelve a tomar en la próxima pasada, no cuando tocaba antes de la pausa.
        await prisma.capturaProgramada.update({ where: { id }, data: { activa: true, proximaAt: new Date() } });
        return NextResponse.json({ ok: true });
    }
    if (b?.accion === "tomar") {
        if (!p.activa) return NextResponse.json({ error: "Está en pausa: reanudala para tomar." }, { status: 409 });
        if (p.terminada) return NextResponse.json({ error: "Ya terminó: subile el tope o corré la fecha para seguir." }, { status: 409 });
        await prisma.capturaProgramada.update({ where: { id }, data: { forzarAt: new Date() } });
        return NextResponse.json({ ok: true });
    }

    const v = validarPrograma(b);
    if ("error" in v) return NextResponse.json({ error: v.error }, { status: 400 });
    const existen = await nombresDeCamaras(v.datos.camaras);
    if (v.datos.camaras.some((c) => !existen.has(c))) return NextResponse.json({ error: "Una de las cámaras ya no existe." }, { status: 400 });
    if (v.datos.tope < p.guardadas) return NextResponse.json({ error: `Ya tomó ${p.guardadas} fotos: el tope no puede ser menor.` }, { status: 400 });
    await prisma.capturaProgramada.update({
        where: { id },
        data: {
            ...v.datos, horario: v.datos.horario ?? Prisma.DbNull,
            // «Terminada» se vuelve a decidir con los números nuevos (queHacer la marca de nuevo si corresponde).
            terminada: null,
            // Si cambió cada cuánto, la próxima vuelta no espera el intervalo viejo.
            ...(v.datos.cadaMin !== p.cadaMin ? { proximaAt: new Date() } : {}),
        },
    });
    return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { error } = await puedeCambiar(); if (error) return error;
    const { id } = await params;
    const p = await prisma.capturaProgramada.delete({ where: { id } }).catch(() => null);
    if (!p) return NextResponse.json({ error: "No existe esa programación" }, { status: 404 });
    return NextResponse.json({ ok: true });
}
