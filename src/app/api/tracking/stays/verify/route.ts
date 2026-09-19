import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { capturarCuadro, leerMatriculas } from "@/lib/cuadro";
import { mismaChapa } from "@/lib/matriculas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * ¿Ese auto sigue ahí? — se va a mirar AHORA.
 *
 * El barrendero cierra las estadías por ausencia: si pasó suficiente tiempo y la cámara
 * miró sin verlo, el vehículo se fue. Es correcto y es lo único que se puede hacer de
 * fondo, en lote, para todas las estadías a la vez. Pero tiene un costo inevitable: entre
 * que el auto se va y que el sistema se entera pasan minutos, porque irse no genera
 * ninguna lectura. Un auto que se fue hace diez minutos sigue figurando estacionado, y no
 * es un error: es que nadie miró todavía.
 *
 * Cuando alguien necesita saberlo EXACTO — está por llamar al dueño, o por anotar una
 * novedad — inferirlo no alcanza. Esto va y mira: toma un cuadro de la cámara en este
 * momento y le pregunta al lector si la chapa sigue en el encuadre.
 *
 * Mira hasta tres veces, con unos segundos entre una y otra. Un solo cuadro no alcanza
 * para afirmar una ausencia: un camión que pasa, alguien parado delante o un reflejo del
 * sol tapan una chapa por un instante, y con un solo intento eso se convertiría en "se
 * fue". Tres miradas separadas no eliminan la duda, pero la vuelven chica; y se corta
 * apenas una lo encuentra, así que el caso normal — el auto está — cuesta una sola.
 *
 * Y hay un tercer resultado que importa tanto como los otros dos: **no se pudo mirar**. Si
 * la cámara no contesta o el lector está caído, la respuesta no es "se fue" — es que no se
 * sabe. Confundir esas dos cosas es exactamente lo que haría que el sistema diera por
 * retirado a un vehículo que está ahí, y esa es una afirmación con la que alguien después
 * toma una decisión.
 */

const MIRADAS = 3;
const ESPERA_MS = 2500;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    const body = await req.json().catch(() => ({} as any));
    const id = String(body?.id || "");
    const plate = String(body?.plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

    const estadia = id
        ? await prisma.plateSighting.findUnique({ where: { id } })
        : plate
            ? await prisma.plateSighting.findFirst({
                where: { plate, estado: "ESTACIONADO", estCerrada: false },
                orderBy: { timestamp: "desc" },
            })
            : null;

    if (!estadia) {
        return NextResponse.json({ error: "No hay una estadía abierta para esa matrícula." }, { status: 404 });
    }
    if (estadia.estCerrada) {
        return NextResponse.json({
            resultado: "cerrada",
            mensaje: "Esa estadía ya estaba cerrada.",
            estHasta: estadia.estHasta,
        });
    }
    if (!estadia.deviceId) {
        return NextResponse.json({ error: "La estadía no tiene cámara asociada: no hay dónde mirar." }, { status: 400 });
    }

    const dev = await prisma.device.findUnique({
        where: { id: estadia.deviceId },
        select: { rtspUrl: true, name: true, trackRoi: true },
    });
    if (!dev?.rtspUrl) {
        return NextResponse.json({ error: "Esa cámara no tiene URL RTSP cargada." }, { status: 400 });
    }

    let roi: any = null;
    try { roi = dev.trackRoi ? JSON.parse(String(dev.trackRoi)) : null; } catch { roi = null; }

    const vistas: { plate: string; confidence: number }[] = [];
    let miradasHechas = 0;
    let fallo: string | null = null;

    for (let i = 0; i < MIRADAS; i++) {
        if (i > 0) await dormir(ESPERA_MS);
        let jpeg: Buffer;
        try {
            jpeg = await capturarCuadro(dev.rtspUrl, { roi, segundos: 15 });
        } catch (e: any) {
            fallo = `No se pudo tomar el cuadro: ${e?.message || e}`;
            continue;
        }
        const { lecturas, error } = await leerMatriculas(jpeg);
        if (error) { fallo = error; continue; }
        miradasHechas++;
        const encontrada = lecturas.find((l) => mismaChapa(l.plate, estadia.plate));
        if (encontrada) {
            // Sigue ahí: la estadía se estira hasta ahora. No se crea una lectura nueva —
            // esto es una verificación pedida a mano, no un avistamiento de la cámara, y
            // meterla en el historial inventaría un paso que no ocurrió.
            const ahora = new Date();
            await prisma.plateSighting.update({
                where: { id: estadia.id },
                data: { estHasta: ahora },
            });
            return NextResponse.json({
                resultado: "sigue",
                mensaje: `Sigue ahí. Lo vio ${dev.name} recién.`,
                plate: encontrada.plate,
                confianza: encontrada.confidence,
                miradas: i + 1,
                estDesde: estadia.estDesde,
                estHasta: ahora,
                camara: dev.name,
            });
        }
        vistas.push(...lecturas.map((l) => ({ plate: l.plate, confidence: l.confidence })));
    }

    // Ninguna mirada sirvió: no se sabe. Esto NO cierra la estadía.
    if (miradasHechas === 0) {
        return NextResponse.json({
            resultado: "sin_respuesta",
            mensaje: fallo || "No se pudo mirar la cámara en este momento.",
            camara: dev.name,
        }, { status: 503 });
    }

    // Se miró y no estaba. La estadía se cierra ahora — y `estHasta` queda en la última
    // vez que SÍ se lo vio, no en este momento: el auto se fue en algún punto entre esas
    // dos marcas, y poner la hora de la verificación diría que estuvo hasta recién.
    const ahora = new Date();
    await prisma.plateSighting.update({
        where: { id: estadia.id },
        data: { estCerrada: true, estHasta: estadia.estHasta || estadia.timestamp },
    });

    return NextResponse.json({
        resultado: "se_fue",
        mensaje: `No está. ${dev.name} miró ${miradasHechas} ${miradasHechas === 1 ? "vez" : "veces"} y no lo encontró.`,
        miradas: miradasHechas,
        /** Lo que sí había en el encuadre, por si la chapa se leyó distinta. */
        otras: vistas.slice(0, 6),
        estDesde: estadia.estDesde,
        estHasta: estadia.estHasta || estadia.timestamp,
        verificadoA: ahora,
        camara: dev.name,
    });
}
