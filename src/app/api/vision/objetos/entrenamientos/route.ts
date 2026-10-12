import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { puedeMirar, puedeCambiar } from "@/lib/zona-entrenable-servidor";
import { resumenClases } from "@/lib/detector-propio-servidor";
import { falta, PARAMETROS_DEFECTO, MODELOS_ENTRENAMIENTO, EPOCAS_MAX } from "@/lib/detector-propio";

export const dynamic = "force-dynamic";

/** Sin latido en este tiempo, el proceso entrenador no está corriendo. */
const LATIDO_VIEJO_MS = 2 * 60_000;
const ULTIMOS = 15;

/** GET: los entrenamientos, y si el entrenador está vivo (latido, imagen construida, ventana). */
export async function GET() {
    const e = await puedeMirar(); if (e) return e;
    const [lista, est] = await Promise.all([
        prisma.entrenamientoDetector.findMany({ orderBy: { createdAt: "desc" }, take: ULTIMOS }),
        prisma.setting.findUnique({ where: { key: "ENTRENADOR_ESTADO" } }),
    ]);
    let entrenador: any = null;
    try { entrenador = est ? JSON.parse(est.value) : null; } catch { entrenador = null; }
    const vivo = !!entrenador && Date.now() - Date.parse(entrenador.latido) < LATIDO_VIEJO_MS;
    return NextResponse.json({ entrenamientos: lista, entrenador: entrenador ? { ...entrenador, vivo } : { vivo: false } }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST { cuando: "noche" | "ahora", modelo?, epocas?, aunAsi? } — poner un entrenamiento en cola.
 * Con el conjunto corto (menos recuadros que el mínimo) hay que pedirlo con `aunAsi`: sirve para
 * probar, pero el modelo no va a servir y la pantalla lo dice antes.
 */
export async function POST(req: NextRequest) {
    const { error, quien } = await puedeCambiar(); if (error) return error;
    const b = await req.json().catch(() => ({}));
    const cuando = b?.cuando === "ahora" ? "ahora" : "noche";
    const modelo = MODELOS_ENTRENAMIENTO.some((m) => m.id === b?.modelo) ? b.modelo : PARAMETROS_DEFECTO.modelo;
    const epocas = Math.min(EPOCAS_MAX, Math.max(1, Number(b?.epocas) || PARAMETROS_DEFECTO.epocas));
    const enCurso = await prisma.entrenamientoDetector.findFirst({ where: { estado: { in: ["EN_COLA", "PREPARANDO", "ENTRENANDO", "EXPORTANDO"] } } });
    if (enCurso) return NextResponse.json({ error: "Ya hay un entrenamiento en cola o corriendo." }, { status: 409 });
    // Uno en pausa ocupa su carpeta con el punto de guardado (~GB): se retoma o se descarta antes.
    if (await prisma.entrenamientoDetector.findFirst({ where: { estado: "PAUSADO" }, select: { id: true } }))
        return NextResponse.json({ error: "Hay un entrenamiento en pausa: retomalo o descartalo antes de empezar otro." }, { status: 409 });
    const [clases, revisadas, negativas] = await Promise.all([
        resumenClases(),
        prisma.fotoEntrenamiento.count({ where: { revisada: true } }),
        prisma.fotoEntrenamiento.count({ where: { revisada: true, cajas: { equals: [] } } }),
    ]);
    if (!clases.length || !clases.some((c) => c.cajas > 0)) return NextResponse.json({ error: "No hay recuadros dibujados todavía." }, { status: 400 });
    const faltan = falta(clases, revisadas, negativas);
    if (faltan.length && !b?.aunAsi) return NextResponse.json({ error: "El conjunto todavía es chico.", falta: faltan }, { status: 409 });
    const t = await prisma.entrenamientoDetector.create({
        data: { cuando, parametros: { ...PARAMETROS_DEFECTO, modelo, epocas }, conjunto: { clases, revisadas, negativas, corto: faltan }, pedidoPor: quien },
    });
    return NextResponse.json({ entrenamiento: t });
}
