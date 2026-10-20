export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { escuchar } from "@/lib/filas/metadatos";

/**
 * GET /api/filas/siluetas?device=<id> → text/event-stream con los objetos que la Bosch está
 * siguiendo, para que el vivo de Filas dibuje las personas (HB, 20/10).
 *
 * Sin GPU y sin OmniVision: lo dice la misma cámara en su flujo de metadatos ONVIF (lib/filas/
 * metadatos, una sola sesión por cámara que comparten todas las pantallas y las fotos). Es lo mismo
 * que la cámara usa para contar: si una persona no aparece acá, la cámara no la ve; si aparece una
 * «persona» en una planta, ese es el falso conteo.
 */

/** Cuántas veces por segundo, como mucho, se le manda a cada pantalla. */
const ENVIOS_POR_SEG = 6;
/** Una conexión dura a lo sumo esto; EventSource se reconecta solo si la pantalla sigue abierta. */
const SESION_MAX_MS = 10 * 60_000;

export async function GET(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Necesitás iniciar sesión" }, { status: 401 });
    const id = req.nextUrl.searchParams.get("device") || "";
    if (!(await prisma.device.findFirst({ where: { id, deviceType: "QUEUE_COUNTER" }, select: { id: true } }))) {
        return NextResponse.json({ error: "No existe ese contador de fila" }, { status: 404 });
    }
    const enc = new TextEncoder();
    let soltar: (() => void) | null = null;
    let tope: NodeJS.Timeout | null = null;
    const stream = new ReadableStream({
        start(ctrl) {
            let cerrado = false, ultimo = 0;
            const mandar = (ev: string, data: unknown) => { if (!cerrado) try { ctrl.enqueue(enc.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { /* cerrado */ } };
            const cerrar = () => { if (cerrado) return; cerrado = true; soltar?.(); if (tope) clearTimeout(tope); try { ctrl.close(); } catch { /* */ } };
            soltar = escuchar(id, (c) => {
                if (c.t - ultimo < 1000 / ENVIOS_POR_SEG) return;
                ultimo = c.t;
                mandar("objetos", c);
            });
            tope = setTimeout(cerrar, SESION_MAX_MS);
            req.signal.addEventListener("abort", cerrar);
            mandar("hola", {});
        },
        cancel() { soltar?.(); if (tope) clearTimeout(tope); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
