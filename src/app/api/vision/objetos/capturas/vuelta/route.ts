import { NextRequest, NextResponse } from "next/server";
import { exigirTokenInterno } from "@/lib/token-interno";
import { darVuelta } from "@/lib/capturas-programadas-servidor";

export const dynamic = "force-dynamic";

/**
 * POST { id } — una vuelta de una programación de capturas. La llama el reloj de vision-worker
 * (vision-capturas.js) con el token interno, no una persona: por eso no pide sesión y sí el token.
 *
 * El reloj está en el proceso y la foto se toma acá para que haya un solo camino con «Sacar foto
 * ahora» (cuadroDeCamara): el stream principal antes que el secundario, el canal del grabador
 * registrado, el mismo tope de tamaño.
 */
export async function POST(req: NextRequest) {
    const no = await exigirTokenInterno(req); if (no) return no;
    const { id } = await req.json().catch(() => ({}));
    if (typeof id !== "string" || !id) return NextResponse.json({ error: "Falta la programación" }, { status: 400 });
    const r = await darVuelta(id);
    if (!r) return NextResponse.json({ error: "No existe esa programación" }, { status: 404 });
    return NextResponse.json(r);
}
