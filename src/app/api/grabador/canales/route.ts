/**
 * /api/grabador/canales — en qué canales busca el grabador con su IA, y cambiarlo.
 *
 * 21/10, Nico: «tengo que saber en qué canales se puede realizar la búsqueda, poder activarlo o no;
 * no sé si busca en todos». No busca en todos: el grabador analiza sólo los canales que tiene
 * encendidos para eso (en los VPro de Otto Villa, 15 de 19 y 15 de 21), y en los otros no encuentra
 * nada aunque la búsqueda los pida.
 *
 *   GET  ?nvr=<id>                         → { ok, motor, texto: [canales] | null, imagen: [canales] | null }
 *   POST { nvr, tipo, canales, probar? }   → { ok, reinician: [canales], error? }
 *        tipo: "texto" | "imagen" | "ambos". Con probar no cambia nada: dice qué cámaras se reinician.
 * Escribir en el grabador pide el permiso Dispositivos y queda en Auditoría.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { conSesion } from "@/lib/acuseek-nvr";
import { grabadorPorId, driverDe } from "@/lib/grabador-busqueda";

const sinCache = { headers: { "Cache-Control": "no-store" } };

export async function GET(req: NextRequest) {
    const no = await conSesion(); if (no) return no;
    const gr = await grabadorPorId(req.nextUrl.searchParams.get("nvr") || "");
    const d = gr ? driverDe(gr.marca) : null;
    if (!gr || !d) return NextResponse.json({ ok: false, error: "Este grabador no busca con IA." }, { status: 404, ...sinCache });
    if (!d.canales) return NextResponse.json({ ok: true, motor: d.motor, texto: null, imagen: null }, sinCache);
    try {
        const c = await d.canales(gr.c);
        return NextResponse.json({ ok: true, motor: d.motor, texto: gr.cap.texto ? c.texto : null, imagen: gr.cap.imagen ? c.imagen : null, posibles: c.posibles ?? null }, sinCache);
    } catch (e: any) { return NextResponse.json({ ok: false, error: e?.message || "El grabador no contestó." }, { status: 502, ...sinCache }); }
}

export async function POST(req: NextRequest) {
    const { getSession } = await import("@/app/actions/auth");
    const { permisosDeSesion } = await import("@/lib/permisos");
    const s: any = await getSession().catch(() => null);
    if (!s) return NextResponse.json({ ok: false, error: "Sin sesión" }, { status: 401 });
    if (!permisosDeSesion(s).includes("dispositivos.editar")) return NextResponse.json({ ok: false, error: "Sólo quien tiene Dispositivos puede cambiar el grabador." }, { status: 403 });

    const b = await req.json().catch(() => ({}));
    const gr = await grabadorPorId(String(b?.nvr || ""));
    const d = gr ? driverDe(gr.marca) : null;
    if (!gr || !d?.ponerCanales) return NextResponse.json({ ok: false, error: "Este grabador no deja elegir los canales desde acá." }, { status: 404 });
    const canales: number[] = Array.isArray(b?.canales) ? b.canales.map(Number).filter((n: number) => Number.isInteger(n) && n > 0 && n <= 256) : [];
    // Primero imagen y después texto: el texto vive encima de la imagen (ver ORDEN_TIPOS).
    const tipos = (b?.tipo === "ambos" ? ["imagen", "texto"] : [b?.tipo]).filter((t): t is "texto" | "imagen" => (t === "texto" && gr.cap.texto) || (t === "imagen" && gr.cap.imagen));
    if (!tipos.length) return NextResponse.json({ ok: false, error: "Ese tipo de búsqueda no lo tiene este grabador." }, { status: 400 });

    const probar = !!b?.probar;
    const reinician = new Set<number>();
    for (const t of tipos) {
        const r = await d.ponerCanales(gr.c, t, canales, probar);
        r.reinician.forEach((n) => reinician.add(n));
        if (!r.ok) {
            if (!probar) await auditar(s, gr.nombre, false, `${t}: ${r.error}`);
            return NextResponse.json({ ok: false, reinician: [...reinician], error: r.error }, { status: 502 });
        }
    }
    if (!probar) await auditar(s, gr.nombre, true, `Búsqueda IA (${tipos.join(" y ")}) en ${canales.length} canales: ${canales.join(", ") || "ninguno"}`);
    return NextResponse.json({ ok: true, reinician: [...reinician].sort((a, b) => a - b) });
}

async function auditar(s: any, objetivo: string, ok: boolean, detalle: string) {
    await prisma.accionSistema.create({ data: { quien: String(s.name || s.sub || "panel"), accion: "Cambió los canales de búsqueda IA del grabador", objetivo, ok, detalle: detalle.slice(0, 500) } }).catch(() => { });
}
