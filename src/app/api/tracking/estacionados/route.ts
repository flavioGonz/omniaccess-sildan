import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { leerCaja, areaTipica, type Caja } from "@/lib/recuadros";
import { ESTACIONADO } from "@/lib/estadias";

export const dynamic = "force-dynamic";
import { funcionActiva } from "@/app/actions/funciones";

/**
 * Los autos que están parados ahora, con lo que hace falta para dibujarlos en el plano.
 *
 * Sólo los CONSOLIDADOS: `estAvisado` distingue una estadía que se sostuvo en el tiempo de
 * una que recién empieza y todavía puede ser un auto esperando para doblar. El plano
 * muestra lo que está pasando, y un auto que puede irse en veinte segundos no está pasando
 * todavía.
 *
 * Va el `areaTipica` de cada cámara porque de eso sale la distancia a la que se dibuja
 * cada auto, y se calcula acá —una vez por cámara— y no en el navegador: son ciento veinte
 * recuadros por cámara que no tienen por qué viajar.
 */
export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    /* Con la función apagada el plano no dibuja autos parados. Se contesta una lista vacía
       y no un error: para quien pregunta, "no hay ninguno" es la respuesta correcta. */
    if (!(await funcionActiva("LPR_ESTADIAS"))) {
        return NextResponse.json({ autos: [], areaTipica: {}, apagado: true });
    }

    const filas = await prisma.plateSighting.findMany({
        where: { source: "TRACK", estado: ESTACIONADO, estCerrada: false, estAvisado: true },
        orderBy: { estDesde: "asc" },
        select: {
            id: true, plate: true, deviceId: true, cameraName: true,
            estDesde: true, estHasta: true, snapshotUrl: true, bbox: true,
            confidence: true, reads: true,
        },
    });

    const camaras = [...new Set(filas.map((f) => f.deviceId).filter(Boolean))] as string[];
    const tipica: Record<string, number | null> = {};
    await Promise.all(camaras.map(async (deviceId) => {
        const recientes = await prisma.plateSighting.findMany({
            where: { deviceId, source: "TRACK", bbox: { not: null } },
            orderBy: { timestamp: "desc" }, take: 120, select: { bbox: true },
        });
        tipica[deviceId] = areaTipica(
            recientes.map((r) => leerCaja(r.bbox)).filter((c): c is Caja => !!c),
        );
    }));

    /* Quién es el dueño de cada chapa. Sin esto el plano muestra una matrícula suelta, y
       la pregunta del guardia nunca es "qué matrícula" sino "de quién es ese auto". */
    const chapas = filas.map((f) => f.plate);
    const vehiculos = chapas.length
        ? await prisma.vehicle.findMany({
            where: { plate: { in: chapas } },
            select: { plate: true, user: { select: { name: true } } },
        })
        : [];
    const duenio = new Map(vehiculos.map((v) => [v.plate, v.user?.name || null]));

    return NextResponse.json({
        autos: filas.map((f) => ({
            id: f.id,
            plate: f.plate,
            persona: duenio.get(f.plate) ?? null,
            conocida: duenio.has(f.plate),
            deviceId: f.deviceId,
            camara: f.cameraName,
            desde: f.estDesde?.toISOString() ?? null,
            visto: f.estHasta?.toISOString() ?? null,
            foto: f.snapshotUrl,
            bbox: f.bbox,
            confianza: f.confidence,
            lecturas: f.reads,
        })),
        areaTipica: tipica,
    });
}
