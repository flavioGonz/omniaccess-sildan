import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor, SIN_CACHE } from "@/lib/monitor/servidor";
import { nuevoToken, SUBIDA_VIDA_MS, SUBIDAS_VIVAS_MAX } from "@/lib/monitor/subida";

export const dynamic = "force-dynamic";

/**
 * POST /api/monitor/camaras/subida: la pared abre un QR para recibir una foto del celular
 * (lib/monitor/subida). Devuelve el id (para consultar) y el token (para la dirección del QR; no
 * se vuelve a ver: en la base queda su hash). La pared arma la dirección con su propio origen.
 *
 * Es el único POST de pantalla que crea una fila, y no cambia nada de la instalación. De paso se
 * borran los códigos vencidos hace rato: no hace falta un proceso aparte para limpiar.
 */
export async function POST() {
    const p = await autorizarMonitor("/api/monitor/camaras/subida");
    if (p.error) return p.error;
    const ahora = Date.now();
    await prisma.subidaFoto.deleteMany({ where: { vence: { lt: new Date(ahora - SUBIDA_VIDA_MS) } } }).catch(() => null);
    const vivas = await prisma.subidaFoto.count({ where: { vence: { gt: new Date(ahora) }, llego: null } });
    if (vivas >= SUBIDAS_VIVAS_MAX) return NextResponse.json({ error: "Hay demasiados códigos abiertos. Probá en unos minutos." }, { status: 429, headers: SIN_CACHE });
    const { token, hash } = await nuevoToken();
    const abrio = p.auth.pantalla ? `pantalla ${p.auth.pantalla.enlaceId}` : `usuario ${p.auth.name || p.auth.userId || "?"}`;
    const s = await prisma.subidaFoto.create({ data: { tokenHash: hash, vence: new Date(ahora + SUBIDA_VIDA_MS), abrio }, select: { id: true, vence: true } });
    return NextResponse.json({ id: s.id, token, vence: s.vence.toISOString() }, { headers: SIN_CACHE });
}
