import { NextRequest, NextResponse } from "next/server";
import { puedeCambiar } from "@/lib/zona-entrenable-servidor";
import { descartarPendientes } from "@/lib/capturas-programadas-servidor";

export const dynamic = "force-dynamic";

/**
 * DELETE — descarta las fotos SIN DIBUJAR que tomó esta programación. Las dibujadas (o marcadas
 * «No hay ninguno») son trabajo de una persona y no se tocan por acá. Anda también con una
 * programación ya borrada: sus fotos conservan la marca.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { error } = await puedeCambiar(); if (error) return error;
    const { id } = await params;
    return NextResponse.json(await descartarPendientes(id));
}
