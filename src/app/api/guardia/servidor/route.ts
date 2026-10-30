import { NextResponse } from "next/server";
import { nombreDelBarrio } from "@/app/actions/invitations";

export const dynamic = "force-dynamic";

/**
 * GET /api/guardia/servidor → «sí, esto es un OmniAccess», y de qué barrio.
 *
 * Lo pregunta la app OmniAccess Guard cuando el guardia escribe la dirección del servidor, antes
 * de pedirle el PIN: así un error de tipeo se ve en ese mismo paso («no existe esa dirección»,
 * «no es un OmniAccess») y no como una página en blanco después. Público y sin datos sensibles:
 * el nombre del barrio ya lo muestra el pase de cualquier invitado.
 */
export async function GET() {
    const barrio = await nombreDelBarrio().catch(() => "");
    return NextResponse.json({ producto: "OmniAccess", barrio: barrio || null, consola: "/guard" }, { headers: { "Cache-Control": "no-store" } });
}
