import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { puedeMirar, puedeCambiar } from "@/lib/zona-entrenable-servidor";
import { activar, activoActual, desactivar } from "@/lib/detector-propio-servidor";
import { VISION_URL } from "@/lib/vision";

export const dynamic = "force-dynamic";

/** GET: el detector propio activo y lo que dice omni-vision de él (si ya lo cargó, cuánto tarda). */
export async function GET() {
    const e = await puedeMirar(); if (e) return e;
    const activo = await activoActual();
    const salud = await fetch(`${VISION_URL()}/salud`, { cache: "no-store", signal: AbortSignal.timeout(4000) }).then((r) => r.json()).catch(() => null);
    return NextResponse.json({ activo, enVision: salud?.propio ?? null }, { headers: { "Cache-Control": "no-store" } });
}

/** POST { entrenamiento } — usar ese modelo en las cámaras (reemplaza al que hubiera). */
export async function POST(req: NextRequest) {
    const { error, quien } = await puedeCambiar(); if (error) return error;
    const b = await req.json().catch(() => ({}));
    const t = await prisma.entrenamientoDetector.findUnique({ where: { id: String(b?.entrenamiento || "") } });
    if (!t) return NextResponse.json({ error: "No existe ese entrenamiento" }, { status: 404 });
    if (t.estado !== "LISTO" && t.estado !== "CANCELADO") return NextResponse.json({ error: "Ese entrenamiento no terminó." }, { status: 409 });
    try {
        return NextResponse.json({ activo: await activar(t as any, quien) });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "No se pudo activar" }, { status: 409 });
    }
}

/** DELETE — dejar de usar el detector propio. Lo registrado con él queda. */
export async function DELETE() {
    const { error } = await puedeCambiar(); if (error) return error;
    await desactivar();
    return NextResponse.json({ ok: true });
}
