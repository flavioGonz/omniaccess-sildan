import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { VISION_URL } from "@/lib/vision";
import { puedeMirar, puedeCambiar } from "@/lib/zona-entrenable-servidor";

export const dynamic = "force-dynamic";

/**
 * El índice de fotos del vocabulario abierto: cuánto hay indexado (omni-vision) y en qué modo
 * indexa vision-vocab-indice.js (Setting VOCAB_INDICE: continuo · noche · apagado).
 *   GET → { indice: {fotos, dias, ultimo_ts, mb…} | null, conf: {modo, ventana, atrasDias, vivo, atras} }
 *   PUT { modo } → cambia el modo (permiso Ajustes).
 */
const CLAVE = "VOCAB_INDICE";
const MODOS = new Set(["continuo", "noche", "apagado"]);

async function conf() {
    const s = await prisma.setting.findUnique({ where: { key: CLAVE } }).catch(() => null);
    try { return { modo: process.env.OMNI_VOCAB_INDICE_MODO || "continuo", ventana: "02:00-06:00", atrasDias: 7, ...(s?.value ? JSON.parse(s.value) : {}) }; }
    catch { return { modo: "continuo", ventana: "02:00-06:00", atrasDias: 7 }; }
}

export async function GET() {
    const e = await puedeMirar(); if (e) return e;
    const indice = await fetch(`${VISION_URL()}/vocabulario/indice`, { cache: "no-store", signal: AbortSignal.timeout(5000) })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    return NextResponse.json({ indice, conf: await conf() }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest) {
    const { error } = await puedeCambiar(); if (error) return error;
    const b = await req.json().catch(() => ({}));
    if (!MODOS.has(b?.modo)) return NextResponse.json({ error: "Modo inválido" }, { status: 400 });
    const c = { ...(await conf()), modo: b.modo };
    await prisma.setting.upsert({ where: { key: CLAVE }, update: { value: JSON.stringify(c) }, create: { key: CLAVE, value: JSON.stringify(c) } });
    return NextResponse.json({ conf: c });
}
