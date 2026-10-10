import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { puedeCambiar } from "@/lib/zona-entrenable-servidor";
import { LARGO_DESCRIPCION, LARGO_NOMBRE, type Caja } from "@/lib/detector-propio";

export const dynamic = "force-dynamic";

/** PUT: cambiar nombre o descripción. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { error } = await puedeCambiar(); if (error) return error;
    const { id } = await params;
    const b = await req.json().catch(() => ({}));
    const nombre = String(b?.nombre || "").trim();
    const descripcion = String(b?.descripcion || "").trim();
    if (!nombre || nombre.length > LARGO_NOMBRE) return NextResponse.json({ error: `El nombre va de 1 a ${LARGO_NOMBRE} letras.` }, { status: 400 });
    if (descripcion.length > LARGO_DESCRIPCION) return NextResponse.json({ error: `La descripción tiene hasta ${LARGO_DESCRIPCION} letras.` }, { status: 400 });
    const c = await prisma.clasePropia.update({ where: { id }, data: { nombre, descripcion: descripcion || null } }).catch(() => null);
    if (!c) return NextResponse.json({ error: "No existe esa clase" }, { status: 404 });
    return NextResponse.json({ clase: c });
}

/**
 * DELETE: borra la clase y sus recuadros de todas las fotos. Las fotos quedan revisadas: quien
 * las revisó dibujó todo lo que había, así que una que sólo tenía recuadros de ésta es un
 * ejemplo negativo correcto para las demás clases.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { error } = await puedeCambiar(); if (error) return error;
    const { id } = await params;
    const fotos = await prisma.fotoEntrenamiento.findMany({ select: { id: true, cajas: true } });
    let tocadas = 0;
    for (const f of fotos) {
        const cajas = (f.cajas as Caja[]) || [];
        if (!cajas.some((c) => c.clase === id)) continue;
        const quedan = cajas.filter((c) => c.clase !== id);
        await prisma.fotoEntrenamiento.update({ where: { id: f.id }, data: { cajas: quedan as any } });
        tocadas++;
    }
    await prisma.clasePropia.delete({ where: { id } }).catch(() => null);
    return NextResponse.json({ ok: true, fotosTocadas: tocadas });
}
