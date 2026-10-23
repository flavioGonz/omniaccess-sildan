import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { FORMA_TOKEN, hashToken, motivoDeRechazo, SUBIDA_MAX_BYTES, TEXTO_RECHAZO } from "@/lib/monitor/subida";

export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "no-store" } as const;

/**
 * La subida desde el celular (openspec pared-vms). PÚBLICA: el celular no tiene usuario, y lo
 * único que autoriza es el token del QR (lib/monitor/subida): un solo uso, 10 minutos, y no deja
 * leer nada de la instalación.
 *
 *   GET  → ¿el código sirve todavía? (la página lo pregunta al abrir, para no hacer sacar una foto en vano)
 *   POST → la foto en el cuerpo (image/jpeg|png|webp, hasta 12 MB)
 */
async function buscar(token: string) {
    if (!FORMA_TOKEN.test(token)) return null;
    return prisma.subidaFoto.findUnique({ where: { tokenHash: await hashToken(token) }, select: { id: true, vence: true, llego: true } });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const s = await buscar(token);
    const m = motivoDeRechazo(s, "image/jpeg", 1);
    return NextResponse.json(m ? { ok: false, motivo: m, error: TEXTO_RECHAZO[m] } : { ok: true, vence: s!.vence.toISOString() }, { headers: SIN_CACHE });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const s = await buscar(token);
    const tipo = (req.headers.get("content-type") || "").split(";")[0].trim();
    const largo = Number(req.headers.get("content-length") || 0);
    // Antes de leer el cuerpo: un código que no sirve o un archivo enorme no se bajan.
    const previo = motivoDeRechazo(s, tipo, largo > SUBIDA_MAX_BYTES ? largo : 1);
    if (previo) return NextResponse.json({ ok: false, motivo: previo, error: TEXTO_RECHAZO[previo] }, { status: previo === "no-existe" ? 404 : previo === "pesa" ? 413 : previo === "tipo" ? 415 : 410, headers: SIN_CACHE });
    const datos = Buffer.from(await req.arrayBuffer());
    const m = motivoDeRechazo(s, tipo, datos.length);
    if (m) return NextResponse.json({ ok: false, motivo: m, error: TEXTO_RECHAZO[m] }, { status: m === "pesa" ? 413 : 400, headers: SIN_CACHE });
    // Sólo si nadie llegó antes (dos envíos a la vez): el código es de una foto.
    const r = await prisma.subidaFoto.updateMany({ where: { id: s!.id, llego: null }, data: { foto: datos, tipo, llego: new Date() } });
    if (!r.count) return NextResponse.json({ ok: false, motivo: "usado", error: TEXTO_RECHAZO.usado }, { status: 410, headers: SIN_CACHE });
    console.log(`[pared] llegó una foto del celular (${Math.round(datos.length / 1024)} KB) para la subida ${s!.id}`);
    return NextResponse.json({ ok: true }, { headers: SIN_CACHE });
}
