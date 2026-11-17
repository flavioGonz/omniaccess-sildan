import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { puedeMirar, puedeCambiar } from "@/lib/zona-entrenable-servidor";
import { fotosParaZona, traerFotosAZona } from "@/lib/fotos-compartidas-servidor";
import { TOPE_TRAER } from "@/lib/fotos-compartidas";

export const dynamic = "force-dynamic";

/**
 * Las fotos del conjunto de entrenamiento de objetos que sirven para esta analítica (son de su
 * cámara y todavía no se trajeron), y traerlas como muestras.
 *
 * GET  — cuántas hay y las primeras, para mostrarlas antes de traer.
 * POST { ids?: [...] } — las trae (todas las que se puedan, o sólo las elegidas).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const no = await puedeMirar(); if (no) return no;
    const { id } = await params;
    const z = await prisma.zonaEntrenable.findUnique({ where: { id }, select: { id: true, deviceId: true } });
    if (!z) return NextResponse.json({ error: "No existe." }, { status: 404 });
    const fotos = await fotosParaZona(z, TOPE_TRAER);
    return NextResponse.json({
        tope: TOPE_TRAER,
        fotos: fotos.map((f) => ({ id: f.id, origen: f.origen, createdAt: f.createdAt })),
    }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { error } = await puedeCambiar(); if (error) return error;
    const { id } = await params;
    const b = await req.json().catch(() => null);
    const ids = Array.isArray(b?.ids) ? b.ids.map(String).slice(0, TOPE_TRAER) : null;
    try {
        return NextResponse.json(await traerFotosAZona(id, ids));
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "No se pudieron traer las fotos" }, { status: 502 });
    }
}
