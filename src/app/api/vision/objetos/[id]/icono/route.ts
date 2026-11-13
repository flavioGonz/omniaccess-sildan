import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { puedeCambiar } from "@/lib/zona-entrenable-servidor";
import { ICONO_MAX_BYTES } from "@/lib/detector-propio";
import { borrarIconoSubido, guardarIconoSubido } from "@/lib/icono-clase-servidor";

export const dynamic = "force-dynamic";

/**
 * POST (cuerpo image/*) — una imagen propia como ícono de la clase: el que se ve al lado del
 * nombre en el vivo. Se achica y se guarda como PNG (ver lib/icono-clase-servidor); queda puesta
 * en el momento, sin esperar a «Guardar». Para volver a uno de la lista, o al de siempre, es el
 * PUT de la clase.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { error } = await puedeCambiar(); if (error) return error;
    const { id } = await params;
    const clase = await prisma.clasePropia.findUnique({ where: { id }, select: { icono: true } });
    if (!clase) return NextResponse.json({ error: "No existe esa clase" }, { status: 404 });
    if (!(req.headers.get("content-type") || "").startsWith("image/")) return NextResponse.json({ error: "Mandá una imagen (PNG, JPG, SVG o WebP)." }, { status: 415 });
    const datos = Buffer.from(await req.arrayBuffer());
    if (!datos.length) return NextResponse.json({ error: "No llegó la imagen" }, { status: 400 });
    if (datos.length > ICONO_MAX_BYTES) return NextResponse.json({ error: "La imagen pesa más de 1 MB: para un ícono alcanza con una chica." }, { status: 413 });
    let icono: string;
    try { icono = await guardarIconoSubido(id, datos); }
    catch { return NextResponse.json({ error: "No se pudo leer la imagen. Probá con un PNG o un SVG." }, { status: 415 }); }
    await prisma.clasePropia.update({ where: { id }, data: { icono } });
    await borrarIconoSubido(clase.icono);
    return NextResponse.json({ icono });
}
