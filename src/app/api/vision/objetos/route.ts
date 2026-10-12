import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { puedeMirar, puedeCambiar } from "@/lib/zona-entrenable-servidor";
import { resumenClases } from "@/lib/detector-propio-servidor";
import { LARGO_DESCRIPCION, LARGO_NOMBRE, falta } from "@/lib/detector-propio";

export const dynamic = "force-dynamic";

/** GET: las clases propias con sus recuadros, cuántas fotos hay y qué falta para entrenar. POST: una clase nueva. */
export async function GET() {
    const e = await puedeMirar(); if (e) return e;
    const [clases, total, revisadas, negativas, origenes] = await Promise.all([
        resumenClases(),
        prisma.fotoEntrenamiento.count(),
        prisma.fotoEntrenamiento.count({ where: { revisada: true } }),
        prisma.fotoEntrenamiento.count({ where: { revisada: true, cajas: { equals: [] } } }),
        prisma.fotoEntrenamiento.groupBy({ by: ["origen"], _count: { _all: true } }),
    ]);
    // De dónde salen las fotos: la pantalla explica por qué conviene que la mayoría sea de las
    // cámaras donde va a correr, y para eso tiene que poder mostrar la mezcla real.
    const porOrigen = Object.fromEntries(origenes.map((o) => [o.origen, o._count._all]));
    return NextResponse.json({ clases, fotos: { total, revisadas, sinRevisar: total - revisadas, negativas, porOrigen }, falta: falta(clases, revisadas, negativas) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
    const { error } = await puedeCambiar(); if (error) return error;
    const b = await req.json().catch(() => ({}));
    const nombre = String(b?.nombre || "").trim();
    const descripcion = String(b?.descripcion || "").trim();
    if (!nombre) return NextResponse.json({ error: "Poné un nombre: «Contenedor de basura», «Cono»." }, { status: 400 });
    if (nombre.length > LARGO_NOMBRE) return NextResponse.json({ error: `El nombre tiene hasta ${LARGO_NOMBRE} letras.` }, { status: 400 });
    if (descripcion.length > LARGO_DESCRIPCION) return NextResponse.json({ error: `La descripción tiene hasta ${LARGO_DESCRIPCION} letras.` }, { status: 400 });
    const repetida = await prisma.clasePropia.findFirst({ where: { nombre: { equals: nombre, mode: "insensitive" } } });
    if (repetida) return NextResponse.json({ error: "Ya hay una clase con ese nombre." }, { status: 409 });
    const c = await prisma.clasePropia.create({ data: { nombre, descripcion: descripcion || null } });
    return NextResponse.json({ clase: c });
}
