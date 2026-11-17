import { NextRequest, NextResponse } from "next/server";
import { puedeCambiar } from "@/lib/zona-entrenable-servidor";
import { mandarMuestrasAlConjunto } from "@/lib/fotos-compartidas-servidor";

export const dynamic = "force-dynamic";

/**
 * POST { ids: [...] } — manda esos recortes al conjunto de entrenamiento del detector de objetos,
 * para dibujarles los recuadros. Las que ya están (porque vinieron de ahí, o porque se mandaron
 * antes) se cuentan aparte y no se duplican.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { error } = await puedeCambiar(); if (error) return error;
    const { id } = await params;
    const b = await req.json().catch(() => null);
    const ids: string[] = Array.isArray(b?.ids) ? b.ids.map(String) : [];
    if (!ids.length) return NextResponse.json({ error: "Faltan las muestras." }, { status: 400 });
    try {
        return NextResponse.json(await mandarMuestrasAlConjunto(id, ids));
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "No se pudieron mandar" }, { status: 502 });
    }
}
