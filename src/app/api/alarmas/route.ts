import { NextRequest, NextResponse } from "next/server";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { listarAlarmas, gestionarAlarma, leerGestion, RANGOS_ALARMAS_H } from "@/lib/alarmas";
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
    // ?id=<alarma>: sólo la gestión de esa alarma (la ficha de intrusión la pide al abrirse).
    const una = req.nextUrl.searchParams.get("id");
    if (una) {
        if (!/^[dal]:[\w-]{1,64}$/.test(una)) return NextResponse.json({ error: "Alarma inválida." }, { status: 400 });
        return NextResponse.json({ gestion: await leerGestion(una) }, { headers: SIN_CACHE });
    }
    const pedido = Number(req.nextUrl.searchParams.get("h"));
    const h = (RANGOS_ALARMAS_H as readonly number[]).includes(pedido) ? pedido : 24;
    const [alarmas, presencia] = await Promise.all([
        listarAlarmas(h).catch((e) => { console.error("[alarmas]", e?.message || e); return null; }),
        calcularPresencia().catch((e) => { console.error("[alarmas] presencia", e?.message || e); return null; }),
    ]);
    if (!alarmas && !presencia) return NextResponse.json({ error: "No se pudieron leer las alarmas." }, { status: 500, headers: SIN_CACHE });
    return NextResponse.json({ horas: h, alarmas: alarmas || [], errorAlarmas: alarmas ? null : "No se pudieron leer las alarmas.", presencia, ahora: new Date().toISOString() }, { headers: SIN_CACHE });
}

/**
 * POST { id, atender?: true, resultado?: "real" | "falsa", nota?: string } — gestionar una alarma.
 * `atender` la da por atendida (con su resultado); `nota` guarda el texto del operador. Una nota
 * sola no la cierra. `nota: ""` la borra; sin `nota`, la que había queda.
 */
export async function POST(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("Un enlace de pantalla no atiende alarmas.");
    const b = await req.json().catch(() => ({}));
    if (typeof b?.id !== "string" || !/^[dal]:[\w-]{1,64}$/.test(b.id)) return NextResponse.json({ error: "Falta la alarma." }, { status: 400 });
    const atender = b.atender === true;
    const resultado = b.resultado === "real" || b.resultado === "falsa" ? b.resultado : null;
    const nota = typeof b.nota === "string" ? b.nota.trim().slice(0, 1000) : null;
    if (!atender && nota === null) return NextResponse.json({ error: "No hay nada que guardar." }, { status: 400 });
    const ok = await gestionarAlarma(b.id, { atender, resultado, nota }, auth.name || auth.userId || null);
    if (!ok) return NextResponse.json({ error: "No existe esa alarma." }, { status: 404 });
    return NextResponse.json({ ok: true, gestion: await leerGestion(b.id) });
}
