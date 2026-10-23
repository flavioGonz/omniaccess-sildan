/**
 * /api/centrales/eventos/<id> — un evento de central (la ficha) y lo que se hace con él.
 *   GET  → { evento, contexto, pasos (bitácora), cierres, procedimiento, video }
 *          `video`: las cámaras de la verificación (zona → área → abonado) y las otras del abonado.
 *   POST { accion: "tomar", motivo? } | { accion: "pasar", nota? } | { accion: "paso", paso, hecho }
 *        | { accion: "saltear", paso, motivo } | { accion: "tratar", cierre, texto }
 *        `tratar` da 409 con `faltan` si queda un paso obligatorio sin hacer ni saltear.
 * La exclusividad y lo obligatorio se controlan acá (lib/centrales/tratamiento), no en la pantalla.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { sesionCon } from "@/lib/centrales/sesion";
import { historialGestion } from "@/lib/gestion-alarma";
import { eventoCentral, leerConfigTratamiento, marcarPaso, pasarEvento, saltearPaso, tomarEvento, tratarEvento } from "@/lib/centrales/tratamiento";
import { exigirFuncion } from "@/lib/funcion-servidor";
import { camarasDeEvento } from "@/lib/centrales/camaras";

const quien = (s: any): string | null => (s?.name as string) || (s?.sub as string) || null;
const ID = /^[\w-]{1,64}$/;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const funcionApagada = await exigirFuncion("FUNC_ALARMAS_GESTION"); if (funcionApagada) return funcionApagada;
    const { id } = await params;
    const { s, no } = await sesionCon(); if (no) return no;
    if (!ID.test(id)) return NextResponse.json({ ok: false, error: "Evento inválido" }, { status: 400 });
    const [d, cfg, hist] = await Promise.all([eventoCentral(id, quien(s)), leerConfigTratamiento(), historialGestion(`d:${id}`)]);
    if (!d) return NextResponse.json({ ok: false, error: "No existe ese evento" }, { status: 404 });
    const video = await camarasDeEvento(d.evento.central.id, d.evento.zona?.zona ?? null).catch(() => ({ camaras: [], origen: "ninguna" as const, area: null, otras: [] }));
    return NextResponse.json({ ok: true, ...d, pasos: hist.pasos, cierres: cfg.cierres.filter((c) => c.activo), procedimiento: cfg.procedimiento, video }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const funcionApagada = await exigirFuncion("FUNC_ALARMAS_GESTION"); if (funcionApagada) return funcionApagada;
    const { id } = await params;
    const { s, no } = await sesionCon("hub.tratar"); if (no) return no;
    if (!ID.test(id)) return NextResponse.json({ ok: false, error: "Evento inválido" }, { status: 400 });
    const yo = quien(s);
    if (!yo) return NextResponse.json({ ok: false, error: "Hace falta una sesión con nombre." }, { status: 401 });
    const b = await req.json().catch(() => ({}));
    const r = b?.accion === "tomar" ? await tomarEvento(id, yo, b.motivo)
        : b?.accion === "pasar" ? await pasarEvento(id, yo, b.nota)
        : b?.accion === "paso" ? await marcarPaso(id, yo, String(b.paso || ""), b.hecho !== false)
        : b?.accion === "saltear" ? await saltearPaso(id, yo, String(b.paso || ""), String(b.motivo || ""))
        : b?.accion === "tratar" ? await tratarEvento(id, yo, String(b.cierre || ""), String(b.texto || ""))
        : { ok: false as const, error: "Acción desconocida", status: 400 };
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: r.error, ...("faltan" in r && r.faltan ? { faltan: r.faltan } : {}) }, { status: r.status || 400 });
}
