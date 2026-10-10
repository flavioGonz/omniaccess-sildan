import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { puedeCambiar } from "@/lib/zona-entrenable-servidor";

export const dynamic = "force-dynamic";

/**
 * POST /api/vision/zonas/<id>/probar — «mirar ahora»: el worker toma una muestra en su próxima
 * vuelta (cada 15 s) sin esperar a que le toque. No se mira desde acá porque el que sabe recortar,
 * puntuar y sostener es el worker; dos caminos para lo mismo terminan dando dos respuestas.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { error } = await puedeCambiar(); if (error) return error;
    const { id } = await params;
    const r = await prisma.zonaEntrenable.updateMany({ where: { id }, data: { forzarAt: new Date() } });
    if (!r.count) return NextResponse.json({ error: "No existe." }, { status: 404 });
    return NextResponse.json({ ok: true });
}
