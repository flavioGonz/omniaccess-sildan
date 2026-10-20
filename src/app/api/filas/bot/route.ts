export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { contestar, COMANDOS } from "@/lib/filas/bot";

/**
 * POST /api/filas/bot { texto } → { texto, foto?, video? } — lo que el bot de Telegram contesta a un
 * comando (lib/filas/bot). Lo llama el worker de despachos, que es quien lee Telegram. Sólo interno
 * (middleware: FILAS_INTERNAS). GET devuelve la lista de comandos para el menú del bot.
 */
export async function POST(req: NextRequest) {
    const b = await req.json().catch(() => ({}));
    try { return NextResponse.json((await contestar(String(b?.texto || ""))) || { ignorar: true }); }
    catch (e: any) { return NextResponse.json({ texto: `No pude contestar: ${e?.message || e}` }); }
}

export async function GET() {
    return NextResponse.json({ comandos: COMANDOS });
}
