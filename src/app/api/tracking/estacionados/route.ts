import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { leerCaja, areaTipica, type Caja } from "@/lib/recuadros";
import { ESTACIONADO } from "@/lib/estadias";
import { celda, leerEsquinas } from "@/lib/franja";

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

    /*
     * Los de franja, que son los que vienen del criterio bueno.
     *
     * Van en la MISMA lista que los otros y con la misma forma: el plano no tiene por qué
     * saber con qué motor se detectó cada auto, y partir la lista en dos obligaría a
     * dibujar dos veces lo mismo. Lo que sí cambia es de dónde sale el recuadro — acá es la
     * celda ocupada, que dice dónde está el AUTO, y no la chapa, que dice dónde está la
     * CHAPA.
     *
     * Y va `areaCelda`: el plano estima la distancia comparando el área del recuadro contra
     * el área típica de las chapas de esa cámara. Una celda es mucho más grande que una
     * chapa, así que con la referencia de las chapas el auto se dibujaría encima del lente.
     * Mandando el área de la propia celda como referencia, la cuenta da la distancia típica
     * — que es lo honesto: la celda dice bien hacia dónde está el auto, y no dice a qué
     * distancia está.
     */
    const ocupadas = await prisma.ocupacion.findMany({
        where: { cerrada: false, avisado: true },
        orderBy: { desde: "asc" },
        include: { franja: true, device: { select: { name: true } } },
    });

    /* Quién es el dueño de cada chapa. Sin esto el plano muestra una matrícula suelta, y
       la pregunta del guardia nunca es "qué matrícula" sino "de quién es ese auto". */
    const chapas = [...new Set([
        ...filas.map((f) => f.plate),
        ...ocupadas.map((o) => o.plate).filter((p): p is string => !!p),
    ])];
    const vehiculos = chapas.length
        ? await prisma.vehicle.findMany({
            where: { plate: { in: chapas } },
            select: { plate: true, user: { select: { name: true } } },
        })
        : [];
    const duenio = new Map(vehiculos.map((v) => [v.plate, v.user?.name || null]));

    type Auto = {
        id: string; plate: string; persona: string | null; conocida: boolean;
        deviceId: string | null; camara: string | null; desde: string | null; visto: string | null;
        foto: string | null; bbox: string | null; confianza: number | null; lecturas: number | null;
        lugar: number | null; areaCelda: number | null;
    };

    const deFranja: Auto[] = ocupadas.map((o) => {
        const esq = leerEsquinas(o.franja.esquinas);
        const q = esq ? celda(esq, o.lugar, o.franja.lugares) : null;
        const xs = q ? q.map((p) => p.x) : [];
        const ys = q ? q.map((p) => p.y) : [];
        const caja = q
            ? { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
            : null;
        return {
            id: o.id,
            plate: o.plate || "",
            persona: o.plate ? duenio.get(o.plate) ?? null : null,
            conocida: !!o.plate && duenio.has(o.plate),
            deviceId: o.deviceId,
            camara: o.device?.name ?? null,
            desde: o.desde.toISOString(),
            visto: o.hasta.toISOString(),
            foto: null,
            bbox: caja ? JSON.stringify(caja) : null,
            confianza: o.plateConf,
            lecturas: 0,
            lugar: o.lugar + 1,
            areaCelda: caja ? Math.abs(caja.w * caja.h) : null,
        };
    });

    const porChapa: Auto[] = filas.map((f) => ({
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
        lugar: null,
        areaCelda: null,
    }));

    return NextResponse.json({ autos: [...deFranja, ...porChapa], areaTipica: tipica });
}
