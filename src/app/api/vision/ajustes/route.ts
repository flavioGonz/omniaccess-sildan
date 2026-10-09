import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { guardarAjuste } from "@/lib/ajustes-db";
import { leerInterruptores } from "@/lib/vision";
import { CLAVE_ANALITICAS, CLAVE_CLASES } from "@/lib/vision-catalogo";

export const dynamic = "force-dynamic";

/**
 * POST /api/vision/ajustes  { tipo: "analitica" | "clase", id, prendida }
 *
 * Prende o apaga una analítica o una clase del detector. Pide el permiso Ajustes: es
 * configuración del sistema, no operación. Se guarda el mapa ENTERO (defectos + cambio), así
 * lo guardado no depende de qué valores por defecto tenga el catálogo mañana.
 */
export async function POST(req: NextRequest) {
    const s: any = await getSession();
    if (!s) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
    if (!permisosDeSesion(s).includes("ajustes")) return NextResponse.json({ error: "Sólo quien tiene Ajustes puede cambiar esto." }, { status: 403 });
    const b = await req.json().catch(() => null);
    const tipo = b?.tipo === "clase" ? "clase" : b?.tipo === "analitica" ? "analitica" : null;
    if (!tipo || typeof b?.id !== "string" || typeof b?.prendida !== "boolean") return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
    const actual = await leerInterruptores();
    const mapa = tipo === "clase" ? actual.clases : actual.analiticas;
    if (!(b.id in mapa)) return NextResponse.json({ error: "No existe" }, { status: 404 });
    mapa[b.id] = b.prendida;
    await guardarAjuste(tipo === "clase" ? CLAVE_CLASES : CLAVE_ANALITICAS, JSON.stringify(mapa));
    return NextResponse.json(await leerInterruptores());
}
