import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { enqueueDispatch } from "@/lib/dispatch-queue";
import { fecha } from "@/lib/fechas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CANALES = ["telegram", "whatsapp", "email", "webhook", "webpush"];

/**
 * Prueba de un canal de notificación. Encola un despacho real por la misma
 * cola que usan las alertas, así la prueba recorre el mismo camino que un
 * evento de verdad — si falla, falla donde fallaría en producción.
 */
export async function POST(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    const body = await req.json().catch(() => ({} as any));
    const canal = String(body?.channel || body?.canal || "").toLowerCase();
    if (!CANALES.includes(canal)) {
        return NextResponse.json({ error: `Canal desconocido: ${canal || "(vacío)"}` }, { status: 400 });
    }

    const cuando = fecha(new Date());
    const trabajo = await enqueueDispatch({
        type: "ALERT",
        channel: canal,
        maxAttempts: 1,
        payload: {
            evento: "prueba",
            asunto: "Prueba de OmniAccess",
            ruleName: "Prueba de canal",
            deviceName: "Consola de administración",
            text: `Prueba de OmniAccess por ${canal}.\nSi estás leyendo esto, el canal funciona.\n${cuando}`,
        },
    });

    // Esperamos un momento al worker para poder decir si salió o por qué no.
    for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const j = await prisma.dispatchJob.findUnique({
            where: { id: trabajo.id },
            select: { status: true, lastError: true },
        });
        if (j?.status === "SENT") return NextResponse.json({ ok: true, estado: "SENT" });
        if (j?.status === "FAILED") {
            return NextResponse.json({ error: j.lastError || "El envío falló", estado: "FAILED" }, { status: 502 });
        }
    }

    return NextResponse.json({
        ok: true,
        estado: "PENDING",
        aviso: "Quedó encolado; mirá el resultado en Despachos.",
    });
}
