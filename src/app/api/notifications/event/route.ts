import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notificarEvento, type EventoNotificable } from "@/lib/reglas-notificacion";

export const dynamic = "force-dynamic";

/**
 * Entrada interna para que el servidor de eventos (server.js, proceso aparte)
 * dispare las reglas de notificación de LPR y de Face. Se protege con el mismo
 * token que la pasarela de seguimiento.
 */
export async function POST(req: NextRequest) {
    let token = process.env.TRACKING_TOKEN || "";
    if (!token) {
        try {
            const s = await prisma.setting.findUnique({ where: { key: "TRACKING_TOKEN" } });
            token = s?.value || "";
        } catch { }
    }
    if (!token || req.headers.get("x-tracking-token") !== token) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const b = (await req.json().catch(() => ({}))) as Partial<EventoNotificable>;
    if (!b?.modulo || !b?.evento) {
        return NextResponse.json({ error: "Falta modulo o evento" }, { status: 400 });
    }

    const encolados = await notificarEvento(b as EventoNotificable);
    return NextResponse.json({ ok: true, encolados });
}
