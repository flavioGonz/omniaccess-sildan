import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
    cerrarEstadia, miradasSinVerlo,
    ESTADIA_VENCE_MIN, ESTADIA_TECHO_MIN, MIRADAS_MIN,
} from "@/lib/estadias";

export const dynamic = "force-dynamic";

/**
 * POST /api/tracking/stays/sweep
 *
 * Cierra las estadías vencidas y avisa que esos vehículos se fueron.
 *
 * Hace falta un barrido porque un auto que se va no genera ninguna lectura. Todo lo demás
 * del seguimiento nace de algo que la cámara vio; esto nace de algo que dejó de ver.
 *
 * Y ahí está lo delicado: **la ausencia solo es evidencia si uno estaba mirando.** La
 * primera versión cerraba por reloj a los doce minutos, y eso partió al mismo auto
 * estacionado toda la noche en cuatro estadías encadenadas, cada una con su "se retiró" y
 * su "estacionó" — porque un auto quieto solo se relee cuando otro vehículo dispara una
 * ráfaga, y de madrugada eso pasa cada veinte o veinticinco minutos.
 *
 * Ahora se cierra cuando pasó el tiempo Y la cámara miró sin verlo: al menos MIRADAS_MIN
 * ráfagas con otras matrículas después de la última vez que se lo vio. Si la cámara no
 * miró — se cayó, o no pasó nadie — la estadía queda abierta hasta el techo, porque el
 * auto probablemente siga ahí y decir que se fue sería inventar.
 *
 * Lo llama la pasarela una vez por minuto. Es idempotente: cerrar una estadía ya cerrada
 * no hace nada ni vuelve a avisar.
 */
export async function POST(req: NextRequest) {
    const token = req.headers.get("x-tracking-token") || "";
    let esperado = process.env.TRACKING_TOKEN || "";
    if (!esperado) {
        const s = await prisma.setting.findUnique({ where: { key: "TRACKING_TOKEN" } });
        esperado = s?.value || "";
    }
    if (!esperado || token !== esperado) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const ahora = Date.now();
    const corte = new Date(ahora - ESTADIA_VENCE_MIN * 60 * 1000);
    const techo = new Date(ahora - ESTADIA_TECHO_MIN * 60 * 1000);

    const candidatas = await prisma.plateSighting.findMany({
        where: {
            source: "TRACK",
            estado: "ESTACIONADO",
            estCerrada: false,
            estHasta: { lt: corte },
        },
        orderBy: { estHasta: "asc" },
        take: 200,
    });
    if (!candidatas.length) {
        return NextResponse.json({ ok: true, revisadas: 0, avisadas: 0, esperando: 0, cerradas: [] });
    }

    // Las lecturas de cada cámara se traen UNA vez, no una por estadía: en una cámara con
    // varias estadías abiertas son las mismas lecturas para todas.
    const masVieja = candidatas.reduce(
        (m, f) => Math.min(m, f.estHasta?.getTime() ?? ahora), ahora,
    );
    const camaras = [...new Set(candidatas.map((f) => f.deviceId).filter(Boolean))] as string[];
    const porCamara = new Map<string, { plate: string; timestamp: Date }[]>();
    await Promise.all(camaras.map(async (deviceId) => {
        const filas = await prisma.plateSighting.findMany({
            where: { deviceId, source: "TRACK", timestamp: { gt: new Date(masVieja) } },
            orderBy: { timestamp: "desc" },
            take: 400,
            select: { plate: true, timestamp: true },
        });
        porCamara.set(deviceId, filas);
    }));

    const cerradas: { plate: string; camara: string | null; minutos: number; motivo: string }[] = [];
    let esperando = 0;

    for (const fila of candidatas) {
        const lecturas = fila.deviceId ? porCamara.get(fila.deviceId) || [] : [];
        const miradas = miradasSinVerlo(fila as any, lecturas);
        const porTecho = (fila.estHasta?.getTime() ?? ahora) < techo.getTime();

        if (miradas < MIRADAS_MIN && !porTecho) {
            // La cámara no volvió a mirar. No hay nada que probar una ausencia.
            esperando++;
            continue;
        }

        const aviso = await cerrarEstadia(fila as any).catch(() => false);
        if (aviso) {
            cerradas.push({
                plate: fila.plate,
                camara: fila.cameraName,
                minutos: Math.round(
                    ((fila.estHasta?.getTime() ?? 0) - (fila.estDesde?.getTime() ?? 0)) / 60000,
                ),
                motivo: porTecho && miradas < MIRADAS_MIN ? "techo" : `${miradas} miradas sin verlo`,
            });
        }
    }

    return NextResponse.json({
        ok: true,
        revisadas: candidatas.length,
        avisadas: cerradas.length,
        // Las que vencieron por reloj pero todavía no tienen prueba de ausencia.
        esperando,
        cerradas,
    });
}
