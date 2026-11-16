export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { PERMISOS_VIDEO } from "@/lib/clip-instante";
import { prepararParaEnviar } from "@/lib/clips-grabados";
import { listarEvidencias } from "@/lib/evidencias-servidor";

/**
 * Evidencias: lo grabado y lo mandado (lib/evidencias).
 *
 *   GET  ?origen=grabado|enviado&q=<texto>&antes=<ms>   la lista, de lo más nuevo a lo más viejo
 *   POST { accion: "preparar", id }                     deja a mano el archivo de un clip grabado, para volver a mandarlo
 *
 * Con sesión y el permiso de grabaciones, los dos.
 */
const SIN_CACHE = { "Cache-Control": "no-store" };

async function permitido(): Promise<NextResponse | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    if (!s) return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
    if (!PERMISOS_VIDEO.some((p) => permisosDeSesion(s).includes(p))) return NextResponse.json({ error: "Tu rol no puede ver las grabaciones." }, { status: 403 });
    return null;
}

export async function GET(req: NextRequest) {
    const no = await permitido(); if (no) return no;
    const sp = req.nextUrl.searchParams, origen = sp.get("origen");
    try {
        const r = await listarEvidencias({ origen: origen === "grabado" || origen === "enviado" ? origen : null, q: (sp.get("q") || "").slice(0, 80), antes: Number(sp.get("antes")) || null });
        return NextResponse.json(r, { headers: SIN_CACHE });
    } catch (e) {
        console.error("[evidencias]", e instanceof Error ? e.message : e);
        return NextResponse.json({ error: "No se pudieron leer las evidencias." }, { status: 500, headers: SIN_CACHE });
    }
}

export async function POST(req: NextRequest) {
    const no = await permitido(); if (no) return no;
    const b = await req.json().catch(() => null);
    if (b?.accion !== "preparar" || typeof b.id !== "string") return NextResponse.json({ ok: false, motivo: "Pedido desconocido." }, { status: 400 });
    return NextResponse.json(await prepararParaEnviar(null, b.id.replace(/^clip-/, "")), { headers: SIN_CACHE });
}
