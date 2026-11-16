export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { PERMISOS_VIDEO } from "@/lib/clip-instante";
import { borrarEvidencia, listarEvidencias, prepararEnvio } from "@/lib/evidencias-servidor";
import { auditar } from "@/lib/centrales/sesion";

/**
 * Evidencias: lo grabado y lo mandado (lib/evidencias).
 *
 *   GET  ?origen=grabado|enviado&q=<texto>&antes=<ms>   la lista, de lo más nuevo a lo más viejo
 *   POST   { accion: "preparar", id }                   deja a mano el archivo de un clip, para volver a mandarlo
 *   DELETE { id, despachos? }                           la borra (queda en la auditoría quién y qué)
 *
 * Con sesión y el permiso de grabaciones, los dos.
 */
const SIN_CACHE = { "Cache-Control": "no-store" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
type Sesion = any;
async function permitido(): Promise<NextResponse | { sesion: Sesion }> {
    const s: Sesion = await getSession().catch(() => null);
    if (!s) return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
    if (!PERMISOS_VIDEO.some((p) => permisosDeSesion(s).includes(p))) return NextResponse.json({ error: "Tu rol no puede ver las grabaciones." }, { status: 403 });
    return { sesion: s };
}

export async function GET(req: NextRequest) {
    const q = await permitido(); if (q instanceof NextResponse) return q;
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
    const q = await permitido(); if (q instanceof NextResponse) return q;
    const b = await req.json().catch(() => null);
    if (b?.accion !== "preparar" || typeof b.id !== "string") return NextResponse.json({ ok: false, motivo: "Pedido desconocido." }, { status: 400 });
    return NextResponse.json(await prepararEnvio(b.id), { headers: SIN_CACHE });
}

export async function DELETE(req: NextRequest) {
    const q = await permitido(); if (q instanceof NextResponse) return q;
    const b = await req.json().catch(() => null);
    if (typeof b?.id !== "string" || !/^(clip|envio)-[\w-]{1,60}$/.test(b.id)) return NextResponse.json({ ok: false, motivo: "Falta cuál." }, { status: 400 });
    const despachos = Array.isArray(b.despachos) ? b.despachos.filter((x: unknown): x is string => typeof x === "string" && /^[\w-]{1,60}$/.test(x)) : [];
    const por = String(q.sesion?.name || q.sesion?.sub || "panel");
    try {
        const r = await borrarEvidencia(b.id, despachos, por);
        await auditar(q.sesion, "evidencia.borrar", String(b.titulo || b.id).slice(0, 120), r.ok, r.ok ? r.detalle : r.motivo);
        return NextResponse.json(r.ok ? { ok: true } : r, { status: r.ok ? 200 : 409, headers: SIN_CACHE });
    } catch (e) {
        console.error("[evidencias] borrar:", e instanceof Error ? e.message : e);
        await auditar(q.sesion, "evidencia.borrar", String(b.titulo || b.id).slice(0, 120), false, "error al borrar");
        return NextResponse.json({ ok: false, motivo: "No se pudo borrar." }, { status: 500, headers: SIN_CACHE });
    }
}
