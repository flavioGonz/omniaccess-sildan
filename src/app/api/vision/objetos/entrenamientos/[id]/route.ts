import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { puedeCambiar } from "@/lib/zona-entrenable-servidor";

export const dynamic = "force-dynamic";

/**
 * DELETE — cancelar. En cola se cancela enseguida (lo hace el entrenador en su próxima vuelta);
 * corriendo, termina la época en curso, exporta lo aprendido hasta ahí y levanta omni-vision.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { error } = await puedeCambiar(); if (error) return error;
    const { id } = await params;
    const t = await prisma.entrenamientoDetector.findUnique({ where: { id } });
    if (!t) return NextResponse.json({ error: "No existe ese entrenamiento" }, { status: 404 });
    if (!["EN_COLA", "PREPARANDO", "ENTRENANDO", "EXPORTANDO"].includes(t.estado)) return NextResponse.json({ error: "Ya terminó." }, { status: 409 });
    await prisma.entrenamientoDetector.update({ where: { id }, data: { cancelar: true } });
    return NextResponse.json({ ok: true });
}
