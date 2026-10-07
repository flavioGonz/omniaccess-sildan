import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addWatch, deactivateWatch } from "@/app/actions/watchlist";
import { normalizarMatricula, resumirCamaras, vigilanciaDe } from "@/lib/lista-negra";

export const dynamic = "force-dynamic";

/**
 * Entrada interna para que el bot de WhatsApp (waha-handler.js, proceso aparte) escriba la
 * lista de vigilancia CON LAS MISMAS acciones que la pantalla: conflicto de categoría,
 * desactivar en vez de borrar, actualización de las lectoras y su resultado. Antes el handler
 * escribía la tabla por su cuenta y las cámaras no se enteraban.
 *
 * Protegida con el mismo token que la pasarela de seguimiento.
 */
export async function POST(req: NextRequest) {
    let token = process.env.TRACKING_TOKEN || "";
    if (!token) {
        try { token = (await prisma.setting.findUnique({ where: { key: "TRACKING_TOKEN" } }))?.value || ""; } catch { }
    }
    if (!token || req.headers.get("x-tracking-token") !== token) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const b = (await req.json().catch(() => ({}))) as { accion?: string; plate?: string; motivo?: string; createdBy?: string; force?: boolean };
    const plate = normalizarMatricula(b.plate);
    if (!plate) return NextResponse.json({ error: "Falta la matrícula" }, { status: 400 });

    if (b.accion === "alta") {
        const r = await addWatch({ plate, category: "BLACKLISTED", motivo: b.motivo || undefined, createdBy: b.createdBy, force: !!b.force, label: b.motivo || "" });
        return NextResponse.json({ ...r, resumen: r.camaras ? resumirCamaras(r.camaras) : null });
    }
    if (b.accion === "baja") {
        const w = await prisma.plateWatch.findUnique({ where: { plate } });
        if (!w || !w.active) {
            const v = await vigilanciaDe(plate);
            return NextResponse.json({ ok: true, estaba: false, porRol: v?.origen === "rol" });
        }
        const r = await deactivateWatch(w.id);
        return NextResponse.json({ ...r, estaba: true, resumen: r.camaras ? resumirCamaras(r.camaras) : null });
    }
    if (b.accion === "estado") {
        return NextResponse.json({ ok: true, vigilancia: await vigilanciaDe(plate) });
    }
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
}
