import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/plates/[plate]/track?from=ISO&to=ISO&limit=500
 *
 * Recorrido cronologico de una matricula: los puntos que despues dibuja el mapa. Solo
 * devuelve avistamientos con coordenadas; los de camaras que todavia no estan ubicadas
 * en el mapa se informan aparte para poder avisarlo en la pantalla.
 *
 * Las estadias van SEPARADAS del recorrido. Un vehiculo estacionado dentro del encuadre
 * de una camara no viajo a ningun lado: meterlo entre los puntos del camino dibujaba
 * tramos que nunca ocurrieron y arruinaba las velocidades, porque el sistema veia un
 * salto entre dos camaras que en realidad estaban mirando el mismo auto quieto.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ plate: string }> }) {
    const { plate } = await params;
    const patente = decodeURIComponent(plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (patente.length < 4) {
        return NextResponse.json({ error: "Matrícula inválida" }, { status: 400 });
    }

    const sp = req.nextUrl.searchParams;
    const hasta = sp.get("to") ? new Date(sp.get("to")!) : new Date();
    const desde = sp.get("from")
        ? new Date(sp.get("from")!)
        : new Date(hasta.getTime() - 24 * 60 * 60 * 1000);
    const limite = Math.min(Number(sp.get("limit") || 500), 2000);

    if (isNaN(desde.getTime()) || isNaN(hasta.getTime())) {
        return NextResponse.json({ error: "Rango de fechas inválido" }, { status: 400 });
    }

    const filas = await prisma.plateSighting.findMany({
        where: { plate: patente, timestamp: { gte: desde, lte: hasta } },
        orderBy: { timestamp: "asc" },
        take: limite,
        select: {
            id: true, plate: true, deviceId: true, cameraName: true,
            lat: true, lng: true, timestamp: true, source: true,
            eventType: true, decision: true, confidence: true, snapshotUrl: true,
            estado: true, estDesde: true, estHasta: true, reads: true,
        },
    });

    const conCoords = filas.filter((f) => f.lat != null && f.lng != null && f.estado !== "ESTACIONADO");
    const sinCoords = filas.filter((f) => f.lat == null || f.lng == null).length;
    const estacionados = filas.filter((f) => f.estado === "ESTACIONADO" && f.lat != null && f.lng != null);

    /**
     * Tramos entre lecturas: SOLO el tiempo transcurrido.
     *
     * Antes esto también daba metros y km/h, calculados con la distancia entre las
     * cámaras en el mapa. Eso resultó ser ficción: las posiciones son puntos puestos a
     * mano y todavía no están verificadas contra dónde están los equipos en la calle.
     * El síntoma fue "386 m en 1 s · 1442 km/h" mostrado con toda seriedad — y el
     * problema no era el cálculo, que estaba bien, sino la entrada.
     *
     * Mientras las ubicaciones no estén confirmadas, el único dato honesto es el
     * tiempo: sale de los relojes de las lecturas y no depende del mapa. Cuando las
     * cámaras estén bien ubicadas se puede volver a agregar distancia y velocidad.
     */
    const tramos = conCoords.slice(1).map((p, i) => {
        const a = conCoords[i];
        const dt = (new Date(p.timestamp).getTime() - new Date(a.timestamp).getTime()) / 1000;
        return {
            desde: a.id,
            hasta: p.id,
            segundos: Math.round(dt),
        };
    });

    return NextResponse.json({
        plate: patente,
        from: desde.toISOString(),
        to: hasta.toISOString(),
        total: filas.length,
        sinUbicacion: sinCoords,
        puntos: conCoords,
        estacionados,
        tramos,
    });
}
