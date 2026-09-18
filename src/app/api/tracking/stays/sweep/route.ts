import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cerrarEstadia, ESTADIA_VENCE_MIN } from "@/lib/estadias";

export const dynamic = "force-dynamic";

/**
 * POST /api/tracking/stays/sweep
 *
 * Cierra las estadías vencidas y avisa que esos vehículos se fueron.
 *
 * Hace falta un barrido porque un auto que se va no genera ninguna lectura. Todo lo demás
 * del seguimiento nace de algo que la cámara vio; esto nace de algo que dejó de ver, y eso
 * solo se puede notar mirando el reloj.
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

    const corte = new Date(Date.now() - ESTADIA_VENCE_MIN * 60 * 1000);

    const vencidas = await prisma.plateSighting.findMany({
        where: {
            source: "TRACK",
            estado: "ESTACIONADO",
            estCerrada: false,
            estHasta: { lt: corte },
        },
        orderBy: { estHasta: "asc" },
        take: 200,
    });

    const cerradas: { plate: string; camara: string | null; minutos: number }[] = [];
    for (const fila of vencidas) {
        const aviso = await cerrarEstadia(fila as any).catch(() => false);
        if (aviso) {
            cerradas.push({
                plate: fila.plate,
                camara: fila.cameraName,
                minutos: Math.round(
                    ((fila.estHasta?.getTime() ?? 0) - (fila.estDesde?.getTime() ?? 0)) / 60000,
                ),
            });
        }
    }

    return NextResponse.json({
        ok: true,
        revisadas: vencidas.length,
        avisadas: cerradas.length,
        cerradas,
    });
}
