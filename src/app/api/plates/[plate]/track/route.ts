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
 * Por encima de esto, el tramo no lo hizo un auto.
 *
 * Adentro de un barrio nadie va a 120 km/h, así que un tramo más rápido que eso no es un
 * dato de velocidad: es la señal de que algo de los dos extremos está mal. O una de las
 * dos matrículas se leyó mal y son autos distintos, o alguna de las cámaras no está en el
 * mapa donde está en la calle.
 *
 * Lo importante es no dibujarlo como un recorrido. Una línea entre dos puntos parece un
 * hecho, y llegó a mostrar "386 m en 1 s · 1442 km/h" con toda seriedad. Un dato imposible
 * presentado como cierto hace dudar de todos los demás, que sí son buenos.
 */
const KMH_IMPOSIBLE = Number(process.env.TRACKING_MAX_KMH || 120);

    // Tramos entre puntos: distancia y tiempo, para mostrar velocidad y pausas.
    const tramos = conCoords.slice(1).map((p, i) => {
        const a = conCoords[i];
        const dt = (new Date(p.timestamp).getTime() - new Date(a.timestamp).getTime()) / 1000;
        const R = 6371000;
        const rad = (x: number) => (x * Math.PI) / 180;
        const dLat = rad(p.lat! - a.lat!);
        const dLng = rad(p.lng! - a.lng!);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat!)) * Math.cos(rad(p.lat!)) * Math.sin(dLng / 2) ** 2;
        const metros = 2 * R * Math.asin(Math.sqrt(h));
        const kmh = dt > 0 ? Math.round((metros / dt) * 3.6) : null;
        return {
            desde: a.id, hasta: p.id,
            segundos: Math.round(dt),
            metros: Math.round(metros),
            kmh,
            dudoso: kmh != null && kmh > KMH_IMPOSIBLE,
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
        // Cuántos tramos no los pudo haber hecho un vehículo. Si hay alguno, el recorrido
        // se muestra con la advertencia en vez de darse por bueno.
        dudosos: tramos.filter((t) => t.dudoso).length,
    });
}
