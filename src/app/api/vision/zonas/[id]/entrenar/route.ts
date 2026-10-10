import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deInt8, entrenar } from "@/lib/zona-entrenable";
import { puedeCambiar, resumenModelo } from "@/lib/zona-entrenable-servidor";

export const dynamic = "force-dynamic";

/**
 * Tope de ejemplos por estado: los más recientes. Más que esto no mejora un promedio y sí
 * arrastra la luz de otra estación del año.
 */
const EJEMPLOS_MAX_POR_ESTADO = 2000;

/** POST /api/vision/zonas/<id>/entrenar — entrena con todo lo etiquetado y guarda el modelo. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { error, quien } = await puedeCambiar(); if (error) return error;
    const { id } = await params;
    const z = await prisma.zonaEntrenable.findUnique({ where: { id }, select: { umbral: true } });
    if (!z) return NextResponse.json({ error: "No existe." }, { status: 404 });
    const leer = (etiqueta: "pos" | "neg") => prisma.muestraZona.findMany({ where: { zonaId: id, etiqueta }, orderBy: { createdAt: "desc" }, take: EJEMPLOS_MAX_POR_ESTADO, select: { vector: true, escala: true } });
    const [pos, neg] = await Promise.all([leer("pos"), leer("neg")]);
    const ejemplos = [...pos.map((m) => ({ v: deInt8(m.vector, m.escala), y: 1 as const })), ...neg.map((m) => ({ v: deInt8(m.vector, m.escala), y: 0 as const }))];
    const t0 = Date.now();
    let modelo;
    try { modelo = entrenar(ejemplos, z.umbral, quien); }
    catch (e: any) { return NextResponse.json({ error: e?.message || "No se pudo entrenar." }, { status: 400 }); }
    // La próxima muestra ya sale con el modelo nuevo: se pide una enseguida para que el estado lo refleje.
    await prisma.zonaEntrenable.update({ where: { id }, data: { modelo: modelo as any, forzarAt: new Date() } });
    return NextResponse.json({ ok: true, modelo: resumenModelo(modelo), ms: Date.now() - t0 });
}
