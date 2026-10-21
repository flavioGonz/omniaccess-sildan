import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { PERMISOS_VIDEO } from "@/lib/clip-instante";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { ventanaPlayback, ANTES_MAX, DESPUES_MAX, DESPUES_MIN } from "@/lib/ventana-playback";
import { AJUSTE_FICHA_ANTES, AJUSTE_FICHA_DESPUES, FICHA_ANTES_POR_DEFECTO, FICHA_DESPUES_POR_DEFECTO, ALERTA_ANTES_MAX, ALERTA_DESPUES_MAX } from "@/lib/clips";

export const dynamic = "force-dynamic";

/**
 * GET /api/playback/ventana → { antes, despues, topes, ficha: { antes, despues } }
 *
 * Los segundos antes/después de un evento viven en Ajustes y los lee el servidor al armar
 * cada clip. La ventana de playback del monitor necesita saberlos del lado del navegador
 * por dos motivos: para que la línea de tiempo sepa en qué instante empieza el video que
 * está reproduciendo (y el cursor avance con él), y para decirle al operador, antes de
 * bajar un clip, cuánto va a traer y dejarle cambiarlo para ese clip.
 */
export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    const v = await ventanaPlayback();
    return NextResponse.json({ ...v, topes: { antesMax: ANTES_MAX, despuesMax: DESPUES_MAX, despuesMin: DESPUES_MIN }, ficha: await ventanaFicha() });
}

/** El video que arranca solo al abrir la ficha (lib/clip-evento): Ajustes → Video del evento. */
async function ventanaFicha() {
    const entero = (v: string | undefined, def: number, min: number, max: number) => { const n = parseInt(String(v ?? ""), 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
    try {
        const filas = await prisma.setting.findMany({ where: { key: { in: [AJUSTE_FICHA_ANTES, AJUSTE_FICHA_DESPUES] } } });
        const v = (k: string) => filas.find((f) => f.key === k)?.value;
        return { antes: entero(v(AJUSTE_FICHA_ANTES), FICHA_ANTES_POR_DEFECTO, 0, ALERTA_ANTES_MAX), despues: entero(v(AJUSTE_FICHA_DESPUES), FICHA_DESPUES_POR_DEFECTO, 1, ALERTA_DESPUES_MAX) };
    } catch { return { antes: FICHA_ANTES_POR_DEFECTO, despues: FICHA_DESPUES_POR_DEFECTO }; }
}

/**
 * PUT /api/playback/ventana { ficha: { antes, despues } } → { ficha }
 *
 * El mismo ajuste de Ajustes → Video del evento, cambiado desde la ficha misma (21/10, Nico: «debo
 * poder indicarle cuántos segundos antes y después… agregale un ícono de settings en la píldora
 * vertical del evento»). Lo puede cambiar quien mira video (monitor, intrusión, historial) o tiene
 * Ajustes: es el que lo sufre. Vale para todas las fichas: LPR, intrusión, OmniVision, alarmas.
 */
export async function PUT(req: NextRequest) {
    let permisos: string[] = [];
    try { const s: any = await getSession(); if (s) permisos = permisosDeSesion(s) as string[]; } catch { }
    if (!permisos.includes("ajustes") && !PERMISOS_VIDEO.some((p) => permisos.includes(p))) return NextResponse.json({ error: "Sin permiso para cambiar el video de la ficha" }, { status: 403 });
    const b: any = await req.json().catch(() => ({}));
    const a = Number(b?.ficha?.antes), d = Number(b?.ficha?.despues);
    if (!Number.isInteger(a) || a < 0 || a > ALERTA_ANTES_MAX || !Number.isInteger(d) || d < 1 || d > ALERTA_DESPUES_MAX)
        return NextResponse.json({ error: `Antes: 0 a ${ALERTA_ANTES_MAX} s · después: 1 a ${ALERTA_DESPUES_MAX} s` }, { status: 400 });
    await prisma.$transaction([
        prisma.setting.upsert({ where: { key: AJUSTE_FICHA_ANTES }, update: { value: String(a) }, create: { key: AJUSTE_FICHA_ANTES, value: String(a) } }),
        prisma.setting.upsert({ where: { key: AJUSTE_FICHA_DESPUES }, update: { value: String(d) }, create: { key: AJUSTE_FICHA_DESPUES, value: String(d) } }),
    ]);
    return NextResponse.json({ ficha: await ventanaFicha() });
}
