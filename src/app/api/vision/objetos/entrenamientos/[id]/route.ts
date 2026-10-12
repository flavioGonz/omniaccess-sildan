import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { puedeCambiar } from "@/lib/zona-entrenable-servidor";
import { borrarEntrenamiento } from "@/lib/detector-propio-servidor";

export const dynamic = "force-dynamic";

/**
 * DELETE — cancelar. En cola se cancela enseguida (lo hace el entrenador en su próxima vuelta);
 * corriendo, termina la época en curso, exporta lo aprendido hasta ahí y levanta omni-vision.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { error } = await puedeCambiar(); if (error) return error;
    const { id } = await params;
    // ?borrar=1: sacar de la lista uno TERMINADO (con su modelo y su carpeta). Sin eso es cancelar.
    if (req.nextUrl.searchParams.get("borrar") === "1") {
        const r = await borrarEntrenamiento(id);
        return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.estado || 400 });
    }
    const t = await prisma.entrenamientoDetector.findUnique({ where: { id } });
    if (!t) return NextResponse.json({ error: "No existe ese entrenamiento" }, { status: 404 });
    // Pausado no hay contenedor que parar: se descarta ya (sin modelo; la poda borra la carpeta).
    if (t.estado === "PAUSADO") {
        await prisma.entrenamientoDetector.update({ where: { id }, data: { estado: "CANCELADO", cancelar: true, terminadoAt: new Date() } });
        return NextResponse.json({ ok: true, descartado: true });
    }
    if (!["EN_COLA", "PREPARANDO", "ENTRENANDO", "EXPORTANDO"].includes(t.estado)) return NextResponse.json({ error: "Ya terminó." }, { status: 409 });
    await prisma.entrenamientoDetector.update({ where: { id }, data: { cancelar: true } });
    return NextResponse.json({ ok: true });
}

/**
 * POST { accion: "pausar" } — para al terminar la época en curso, sin exportar: libera la GPU y
 * vuelve OmniVision. Queda PAUSADO con su punto de guardado (last.ckpt).
 * POST { accion: "retomar", cuando?: "ahora" | "noche" } — lo vuelve a la cola; sigue desde la
 * época donde quedó, con el mismo conjunto.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { error } = await puedeCambiar(); if (error) return error;
    const { id } = await params;
    const b = await req.json().catch(() => ({}));
    const t = await prisma.entrenamientoDetector.findUnique({ where: { id } });
    if (!t) return NextResponse.json({ error: "No existe ese entrenamiento" }, { status: 404 });
    const p: any = t.parametros || {};
    if (b?.accion === "pausar") {
        // Sólo entrenando: preparando todavía no hay punto de guardado, y exportando ya casi termina.
        if (t.estado !== "ENTRENANDO") return NextResponse.json({ error: t.estado === "EN_COLA" ? "Todavía no arrancó: si no lo querés, cancelalo." : "Sólo se puede pausar mientras entrena." }, { status: 409 });
        if (t.cancelar) return NextResponse.json({ error: "Ya se está cancelando." }, { status: 409 });
        await prisma.entrenamientoDetector.update({ where: { id }, data: { parametros: { ...p, pausar: true } } });
        return NextResponse.json({ ok: true });
    }
    if (b?.accion === "retomar") {
        if (t.estado !== "PAUSADO") return NextResponse.json({ error: "No está en pausa." }, { status: 409 });
        const otro = await prisma.entrenamientoDetector.findFirst({ where: { id: { not: id }, estado: { in: ["EN_COLA", "PREPARANDO", "ENTRENANDO", "EXPORTANDO"] } } });
        if (otro) return NextResponse.json({ error: "Hay otro entrenamiento en cola o corriendo." }, { status: 409 });
        await prisma.entrenamientoDetector.update({ where: { id }, data: {
            estado: "EN_COLA", cuando: b?.cuando === "noche" ? "noche" : "ahora", cancelar: false,
            parametros: { ...p, pausar: false, reanudar: true },
        } });
        return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
}
