import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { puedeCambiar } from "@/lib/zona-entrenable-servidor";
import { LARGO_DESCRIPCION, LARGO_NOMBRE, PREFIJO_ICONO_IMAGEN, UMBRAL_PANTALLA_MAX, UMBRAL_PANTALLA_MIN, esClaveIcono, type Caja } from "@/lib/detector-propio";
import { borrarIconoSubido } from "@/lib/icono-clase-servidor";

export const dynamic = "force-dynamic";

/**
 * PUT: cambiar nombre, descripción, ícono o desde qué confianza se dibuja en el vivo.
 * `icono`: una clave de ICONOS_CLASE, o null para volver al de siempre. Una imagen propia no entra
 * por acá sino por …/icono (POST), que la achica y la guarda; si no viene, el ícono no se toca.
 * `umbralPantalla`: 0-1; si no viene, no se toca.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { error } = await puedeCambiar(); if (error) return error;
    const { id } = await params;
    const b = await req.json().catch(() => ({}));
    const nombre = String(b?.nombre || "").trim();
    const descripcion = String(b?.descripcion || "").trim();
    if (!nombre || nombre.length > LARGO_NOMBRE) return NextResponse.json({ error: `El nombre va de 1 a ${LARGO_NOMBRE} letras.` }, { status: 400 });
    if (descripcion.length > LARGO_DESCRIPCION) return NextResponse.json({ error: `La descripción tiene hasta ${LARGO_DESCRIPCION} letras.` }, { status: 400 });
    const antes = await prisma.clasePropia.findUnique({ where: { id }, select: { icono: true } });
    if (!antes) return NextResponse.json({ error: "No existe esa clase" }, { status: 404 });
    const data: { nombre: string; descripcion: string | null; icono?: string | null; umbralPantalla?: number } = { nombre, descripcion: descripcion || null };
    if (b?.icono !== undefined) {
        // La imagen ya guardada vuelve tal cual desde la pantalla: se acepta sólo si es la misma.
        const mismaImagen = typeof b.icono === "string" && b.icono.startsWith(PREFIJO_ICONO_IMAGEN) && b.icono === antes.icono;
        if (b.icono !== null && !esClaveIcono(b.icono) && !mismaImagen) return NextResponse.json({ error: "Ese ícono no está en la lista." }, { status: 400 });
        data.icono = b.icono;
    }
    if (b?.umbralPantalla !== undefined) {
        const u = Number(b.umbralPantalla);
        if (!Number.isFinite(u) || u < UMBRAL_PANTALLA_MIN || u > UMBRAL_PANTALLA_MAX) return NextResponse.json({ error: `El porcentaje va de ${Math.round(UMBRAL_PANTALLA_MIN * 100)} a ${Math.round(UMBRAL_PANTALLA_MAX * 100)}.` }, { status: 400 });
        data.umbralPantalla = Math.round(u * 100) / 100;
    }
    const c = await prisma.clasePropia.update({ where: { id }, data });
    // Si tenía una imagen subida y dejó de usarla, el archivo no queda huérfano en el disco.
    if (data.icono !== undefined && antes.icono && antes.icono !== data.icono) await borrarIconoSubido(antes.icono);
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
    const borrada = await prisma.clasePropia.delete({ where: { id } }).catch(() => null);
    if (borrada?.icono) await borrarIconoSubido(borrada.icono);
    return NextResponse.json({ ok: true, fotosTocadas: tocadas });
}
