import { NextRequest, NextResponse } from "next/server";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { alarmasActivas } from "@/lib/alarmas";
import { registrarGestion } from "@/lib/gestion-alarma";
import { avisarPorSocket } from "@/lib/avisar";

export const dynamic = "force-dynamic";

/**
 * GET  /api/avisos/activas → { activas: AlarmaActiva[] }
 * POST /api/avisos/activas { id } → la desactiva (resuelta)
 *
 * Las alarmas que alguien confirmó como reales y siguen activas (lib/alarmas alarmasActivas): la
 * pila de avisos las deja encendidas, con quién la confirmó y la foto, hasta que se desactivan.
 * Desactivar queda en la bitácora de la alarma (DESACTIVO) y le avisa a las otras pantallas.
 */
export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    return NextResponse.json({ activas: await alarmasActivas() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("Un enlace de pantalla no desactiva alarmas.");
    const b = await req.json().catch(() => ({}));
    if (typeof b?.id !== "string" || !/^[al]:[\w-]{1,64}$/.test(b.id)) return NextResponse.json({ error: "Falta la alarma." }, { status: 400 });
    const por = auth.name || auth.userId || null;
    await registrarGestion(b.id, "DESACTIVO", por);
    // registrarGestion ya avisa «alarma_gestion» (la bitácora en vivo); éste es para la pila.
    avisarPorSocket("alarma_resuelta", { id: b.id, por });
    return NextResponse.json({ ok: true });
}
