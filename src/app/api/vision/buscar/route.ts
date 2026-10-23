import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { pareceChapa, pasosDeChapa, pistasDePasos } from "@/lib/vision-historial";
import { buscarConFoto, comparar, deInt8, rango, responder, vectorDeTexto } from "@/lib/vision-parecidos";

export const dynamic = "force-dynamic";

/*
 * Qué hace cada pedido está en lib/vision-parecidos (23/10, openspec pared-vms: la lógica salió de
 * acá para que la pared de Cámaras busque con la misma, por /api/monitor/camaras/buscar).
 */

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("La búsqueda no es una vista de pantalla.");
    const sp = req.nextUrl.searchParams;
    const q = String(sp.get("q") || "").trim().slice(0, 200);
    const parecido = sp.get("parecido");
    if (!q && !parecido) return NextResponse.json({ error: "Escribí qué buscar" }, { status: 400 });
    const t0 = Date.now();

    // Una matrícula no se busca por cómo se ve («SBX1234» no describe nada para SigLIP): se busca
    // en el historial de accesos, y de cada paso se traen las pistas de OmniVision del vehículo.
    const chapa = !parecido && q ? pareceChapa(q) : null;
    if (chapa) {
        const r = rango(sp);
        const pasos = await pasosDeChapa(chapa, new Date(Date.now() - r.h * 3600_000));
        const pistas = await pistasDePasos(pasos);
        return responder(pistas.map((f) => ({ f, coseno: 1, prob: null })), { comparados: pasos.length, sinHuella: 0, h: r.h, t0, modo: "chapa", pasos });
    }

    let consulta: Float32Array, escala: number | null = null, sesgo: number | null = null;
    try {
        if (parecido) {
            const hu = await prisma.huellaObjeto.findUnique({ where: { objetoId: parecido } });
            if (!hu) return NextResponse.json({ error: "Esa pista todavía no tiene huella" }, { status: 404 });
            consulta = deInt8(hu.vector, hu.escala);
        } else {
            const t = await vectorDeTexto(q);
            consulta = t.v; escala = t.escala; sesgo = t.sesgo;
        }
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "omni-vision no contestó" }, { status: 502 });
    }
    return comparar(consulta, escala, sesgo, rango(sp), parecido, parecido ? "parecido" : "texto", t0);
}

/** Con una foto: los objetos que hay en ella, o lo parecido a ella (lib/vision-parecidos). */
export async function POST(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("La búsqueda no es una vista de pantalla.");
    return buscarConFoto(req);
}
