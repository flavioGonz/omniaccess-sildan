import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { alLeerMatricula, type Lectura } from "@/lib/visitas/motor";

export const dynamic = "force-dynamic";

/**
 * POST /api/visitas/lectura — entrada interna para el motor de visitas y patrones.
 * server.js (proceso aparte) la llama, sin esperar la respuesta, despues de guardar cada
 * lectura LPR. Protegida con el token interno (Setting TRACKING_TOKEN o env).
 * El motor nunca toca la barrera: solo abre/cierra visitas y crea avisos a la guardia.
 */
export async function POST(req: NextRequest) {
    let token = process.env.TRACKING_TOKEN || "";
    if (!token) { try { token = (await prisma.setting.findUnique({ where: { key: "TRACKING_TOKEN" } }))?.value || ""; } catch { } }
    if (!token || req.headers.get("x-tracking-token") !== token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const b = (await req.json().catch(() => ({}))) as Partial<Lectura>;
    if (!b?.modulo || !b?.evento) return NextResponse.json({ error: "Falta modulo o evento" }, { status: 400 });
    void alLeerMatricula(b as Lectura);
    return NextResponse.json({ ok: true });
}
