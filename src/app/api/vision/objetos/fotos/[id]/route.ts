import { NextRequest, NextResponse } from "next/server";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { getS3Client } from "@/lib/s3";
import { puedeCambiar } from "@/lib/zona-entrenable-servidor";
import { BUCKET, filaFoto } from "@/lib/detector-propio-servidor";
import { validarCajas } from "@/lib/detector-propio";

export const dynamic = "force-dynamic";

/**
 * PUT { cajas, revisada } — los recuadros de la foto. `revisada: true` con la lista vacía es
 * «acá no hay ninguno»: un ejemplo negativo.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { error, quien } = await puedeCambiar(); if (error) return error;
    const { id } = await params;
    const b = await req.json().catch(() => ({}));
    const clases = new Set((await prisma.clasePropia.findMany({ select: { id: true } })).map((c) => c.id));
    const v = validarCajas(b?.cajas, clases);
    if ("error" in v) return NextResponse.json({ error: v.error }, { status: 400 });
    const revisada = b?.revisada !== false;
    const f = await prisma.fotoEntrenamiento.update({ where: { id }, data: { cajas: v.cajas as any, revisada, revisadaPor: revisada ? quien : null } }).catch(() => null);
    if (!f) return NextResponse.json({ error: "No existe esa foto" }, { status: 404 });
    return NextResponse.json({ foto: await filaFoto(f) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { error } = await puedeCambiar(); if (error) return error;
    const { id } = await params;
    const f = await prisma.fotoEntrenamiento.delete({ where: { id } }).catch(() => null);
    if (!f) return NextResponse.json({ error: "No existe esa foto" }, { status: 404 });
    // La fila ya no está aunque falle el bucket; se dice, para que nadie crea que se liberó el espacio.
    const borrada = await (async () => { try { await (await getS3Client()).send(new DeleteObjectCommand({ Bucket: BUCKET, Key: f.clave })); return true; } catch { return false; } })();
    return NextResponse.json({ ok: true, fotoBorrada: borrada });
}
