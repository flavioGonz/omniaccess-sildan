export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { DIR_CLIPS } from "@/lib/clip-instante";
import { videoConMarca } from "@/lib/filas/presentacion";

/**
 * POST /api/filas/video-marcado { nombre, datos:{ fila, titulo, personas, limite, esperaMin, momento } }
 * → { nombre } del clip con la presentación de OmniAccess adelante (lib/filas/presentacion). Si no
 * sale, contesta { nombre } del original: el aviso no se queda sin video por la marca.
 * Sólo interno (la pide el worker de despachos).
 */
export async function POST(req: NextRequest) {
    const b = await req.json().catch(() => ({}));
    const nombre = String(b?.nombre || "");
    if (!/^[\w.-]+\.mp4$/.test(nombre)) return NextResponse.json({ error: "Nombre inválido" }, { status: 400 });
    const d = b?.datos || {};
    const salida = await videoConMarca(path.join(DIR_CLIPS, nombre), {
        fila: String(d.fila || "Fila"), titulo: String(d.titulo || "Control de filas"),
        personas: d.personas == null ? null : Number(d.personas), limite: Number(d.limite) || 0,
        esperaMin: d.esperaMin == null ? null : Number(d.esperaMin), momento: d.momento ? new Date(d.momento) : new Date(),
    });
    return NextResponse.json({ nombre: salida ? path.basename(salida) : nombre, marcado: !!salida });
}
