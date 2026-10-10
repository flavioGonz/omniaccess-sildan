import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deInt8, puntuar, type ModeloZona } from "@/lib/zona-entrenable";
import { puedeMirar, puedeCambiar, imagen } from "@/lib/zona-entrenable-servidor";

export const dynamic = "force-dynamic";

/** Cuántas se devuelven por pedido: una grilla que se etiqueta de una sentada. */
const POR_PAGINA = 48;
/** Para «dudosas» se puntúan las sin etiquetar más recientes; más atrás ya no ayuda a decidir. */
const DUDOSAS_MAX = 3000;

/**
 * GET /api/vision/zonas/<id>/muestras?vista=dudosas|sin|pos|neg|todas[&antes=<iso>]
 *
 * Con modelo entrenado, la probabilidad se recalcula con el modelo VIGENTE (la guardada es la del
 * momento de la toma, quizás con frases o con un modelo viejo): lo que se ve es lo que diría hoy.
 *
 * «Dudosas» son las sin etiquetar más cerca del umbral: etiquetar ésas es lo que más mejora el
 * modelo (las que ya acierta con 99 % no le enseñan nada).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const no = await puedeMirar(); if (no) return no;
    const { id } = await params;
    const z = await prisma.zonaEntrenable.findUnique({ where: { id }, select: { modelo: true, umbral: true } });
    if (!z) return NextResponse.json({ error: "No existe." }, { status: 404 });
    const vista = req.nextUrl.searchParams.get("vista") || "dudosas";
    const antes = req.nextUrl.searchParams.get("antes");
    const modelo = (z.modelo as ModeloZona | null) || null;
    const conProb = (m: { vector: Buffer | Uint8Array; escala: number; prob: number | null }) => {
        const p = modelo ? puntuar(modelo, deInt8(m.vector, m.escala)) : null;
        return p ?? m.prob;
    };
    const forma = (m: any) => ({
        id: m.id, url: imagen(m.recorte), prob: conProb(m) ?? null, probTomada: m.prob, fuente: m.fuente,
        etiqueta: m.etiqueta, etiquetadoPor: m.etiquetadoPor, ts: m.createdAt.toISOString(),
    });
    const sel = { id: true, recorte: true, vector: true, escala: true, prob: true, fuente: true, etiqueta: true, etiquetadoPor: true, createdAt: true } as const;

    if (vista === "dudosas") {
        const filas = await prisma.muestraZona.findMany({ where: { zonaId: id, etiqueta: null }, orderBy: { createdAt: "desc" }, take: DUDOSAS_MAX, select: sel });
        const muestras = filas.map(forma).filter((m) => m.prob != null).sort((a, b) => Math.abs(a.prob! - z.umbral) - Math.abs(b.prob! - z.umbral)).slice(0, POR_PAGINA);
        return NextResponse.json({ muestras, hayMas: false }, { headers: { "Cache-Control": "no-store" } });
    }
    const where: any = { zonaId: id };
    if (vista === "sin") where.etiqueta = null; else if (vista === "pos" || vista === "neg") where.etiqueta = vista;
    if (antes) where.createdAt = { lt: new Date(antes) };
    const filas = await prisma.muestraZona.findMany({ where, orderBy: { createdAt: "desc" }, take: POR_PAGINA + 1, select: sel });
    return NextResponse.json({ muestras: filas.slice(0, POR_PAGINA).map(forma), hayMas: filas.length > POR_PAGINA }, { headers: { "Cache-Control": "no-store" } });
}

/** PATCH { ids: [...], etiqueta: "pos" | "neg" | null } — etiquetar (o desetiquetar) de a varias. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { error, quien } = await puedeCambiar(); if (error) return error;
    const { id } = await params;
    const b = await req.json().catch(() => null);
    const ids: string[] = Array.isArray(b?.ids) ? b.ids.map(String).slice(0, 500) : [];
    const etiqueta = b?.etiqueta === "pos" || b?.etiqueta === "neg" ? b.etiqueta : b?.etiqueta === null ? null : undefined;
    if (!ids.length || etiqueta === undefined) return NextResponse.json({ error: "Faltan las muestras o la etiqueta." }, { status: 400 });
    const r = await prisma.muestraZona.updateMany({
        where: { zonaId: id, id: { in: ids } },
        data: { etiqueta, etiquetadoPor: etiqueta ? quien : null, etiquetadoAt: etiqueta ? new Date() : null },
    });
    return NextResponse.json({ ok: true, cambiadas: r.count });
}
