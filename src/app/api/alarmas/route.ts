import { NextRequest, NextResponse } from "next/server";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { listarAlarmas, atenderAlarma, RANGOS_ALARMAS_H } from "@/lib/alarmas";
import { calcularPresencia } from "@/lib/presencia";

export const dynamic = "force-dynamic";
const SIN_CACHE = { "Cache-Control": "no-store" } as const;

/**
 * GET /api/alarmas?h=24 → las alarmas de todas las fuentes (lib/alarmas) y quién está adentro
 * (lib/presencia), para la pantalla Gestión de alarmas. Las dos cosas en un pedido: la pantalla
 * las muestra juntas y se refrescan juntas.
 */
export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("La gestión de alarmas no es una vista de pantalla.");
    const pedido = Number(req.nextUrl.searchParams.get("h"));
    const h = (RANGOS_ALARMAS_H as readonly number[]).includes(pedido) ? pedido : 24;
    const [alarmas, presencia] = await Promise.all([
        listarAlarmas(h).catch((e) => { console.error("[alarmas]", e?.message || e); return null; }),
        calcularPresencia().catch((e) => { console.error("[alarmas] presencia", e?.message || e); return null; }),
    ]);
    if (!alarmas && !presencia) return NextResponse.json({ error: "No se pudieron leer las alarmas." }, { status: 500, headers: SIN_CACHE });
    return NextResponse.json({ horas: h, alarmas: alarmas || [], errorAlarmas: alarmas ? null : "No se pudieron leer las alarmas.", presencia, ahora: new Date().toISOString() }, { headers: SIN_CACHE });
}

/** POST { id, resultado?: "real" | "falsa", nota? } — atender una alarma. */
export async function POST(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("Un enlace de pantalla no atiende alarmas.");
    const b = await req.json().catch(() => ({}));
    if (typeof b?.id !== "string" || !/^[dal]:[\w-]{1,64}$/.test(b.id)) return NextResponse.json({ error: "Falta la alarma." }, { status: 400 });
    const resultado = b.resultado === "real" || b.resultado === "falsa" ? b.resultado : null;
    const nota = typeof b.nota === "string" ? b.nota.trim().slice(0, 300) || null : null;
    const ok = await atenderAlarma(b.id, resultado, nota, auth.name || auth.userId || null);
    if (!ok) return NextResponse.json({ error: "Esa alarma ya estaba atendida." }, { status: 409 });
    return NextResponse.json({ ok: true });
}
