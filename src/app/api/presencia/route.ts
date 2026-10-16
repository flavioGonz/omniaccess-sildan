import { NextRequest, NextResponse } from "next/server";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { autorizarMonitor, SIN_CACHE } from "@/lib/monitor/servidor";
import { calcularPresencia, marcarPresencia } from "@/lib/presencia";
import { cerrarVisita } from "@/lib/visitas/registro";
import { avisarPorSocket } from "@/lib/avisar";

export const dynamic = "force-dynamic";

/** GET /api/presencia → quién está adentro: autos de residentes, residentes, autos de visita, visitas (lib/presencia). */
export async function GET() {
    const p = await autorizarMonitor("/api/presencia");
    if (p.error) return p.error;
    try {
        return NextResponse.json(await calcularPresencia(), { headers: SIN_CACHE });
    } catch (e: any) {
        console.error("[presencia]", e?.message || e);
        return NextResponse.json({ error: "No se pudo calcular quién está adentro." }, { status: 500, headers: SIN_CACHE });
    }
}

/**
 * POST /api/presencia — una corrección del guardia.
 *  { plate, estado: "AFUERA" | "ADENTRO" }  → marca la chapa (vale hasta su próxima lectura).
 *  { visitaId }                              → cierra esa visita registrada («se fue»).
 * Un enlace de pantalla es de sólo lectura: no corrige nada.
 */
export async function POST(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("Un enlace de pantalla no puede cambiar quién está adentro.");
    const b = await req.json().catch(() => ({}));
    const por = auth.name || auth.userId || null;
    if (typeof b?.visitaId === "string" && b.visitaId) {
        const v = await cerrarVisita(b.visitaId, { cierre: "GUARDIA", por });
        if (!v) return NextResponse.json({ error: "Esa visita ya estaba cerrada." }, { status: 409 });
        return NextResponse.json({ ok: true });
    }
    const estado = b?.estado === "ADENTRO" ? "ADENTRO" : b?.estado === "AFUERA" ? "AFUERA" : null;
    if (typeof b?.plate !== "string" || !estado) return NextResponse.json({ error: "Falta la matrícula o el estado." }, { status: 400 });
    const m = await marcarPresencia(b.plate, estado, por);
    if (!m) return NextResponse.json({ error: "Esa matrícula no es válida." }, { status: 400 });
    avisarPorSocket("presencia", { plate: m.plate, estado: m.estado });
    return NextResponse.json({ ok: true });
}
