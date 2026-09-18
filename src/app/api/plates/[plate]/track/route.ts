import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/plates/[plate]/track?from=ISO&to=ISO&limit=500
 * Recorrido cronologico de una matricula: los puntos que despues dibuja el mapa.
 * Solo devuelve avistamientos con coordenadas (los que no tienen camara ubicada
 * en el mapa se informan aparte, para poder avisar en la interfaz).
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
        },
    });

    const conCoords = filas.filter((f) => f.lat != null && f.lng != null);
    const sinCoords = filas.length - conCoords.length;

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
        return {
            desde: a.id, hasta: p.id,
            segundos: Math.round(dt),
            metros: Math.round(metros),
            kmh: dt > 0 ? Math.round((metros / dt) * 3.6) : null,
        };
    });

    return NextResponse.json({
        plate: patente,
        from: desde.toISOString(),
        to: hasta.toISOString(),
        total: filas.length,
        sinUbicacion: sinCoords,
        puntos: conCoords,
        tramos,
    });
}
