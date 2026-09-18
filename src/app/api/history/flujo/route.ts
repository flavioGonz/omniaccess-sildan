import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/history/flujo?plate=XXX&at=ISO
 *
 * El recorrido completo de una matrícula alrededor de un momento: por qué cámaras pasó,
 * en qué orden y cuánto tardó entre una y otra.
 *
 * Es la pregunta que una fila sola nunca contesta. "SBG8905 en Calle 22 a las 17:23" no
 * dice si el auto venía de la entrada, si dio una vuelta o si está estacionado hace una
 * hora — y esa es justamente la pregunta que alguien se hace cuando mira el historial.
 *
 * Entre dos pasos se informa SOLO el tiempo, nunca distancia ni velocidad. Las posiciones
 * de las cámaras en el mapa todavía no están verificadas contra dónde están los equipos
 * en la calle, y cualquier número derivado de ellas sería inventado.
 */

/** Ventana alrededor del momento consultado. Un recorrido por el barrio entra holgado. */
const VENTANA_MIN = Number(process.env.TRACKING_FLOW_WINDOW_MIN || 90);

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    const sp = req.nextUrl.searchParams;
    const plate = (sp.get("plate") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (plate.length < 4) return NextResponse.json({ error: "Matrícula inválida" }, { status: 400 });

    const centro = sp.get("at") ? new Date(sp.get("at") as string) : new Date();
    if (isNaN(+centro)) return NextResponse.json({ error: "Momento inválido" }, { status: 400 });

    const desde = new Date(centro.getTime() - VENTANA_MIN * 60 * 1000);
    const hasta = new Date(centro.getTime() + VENTANA_MIN * 60 * 1000);

    const [accesos, avistamientos] = await Promise.all([
        prisma.accessEvent.findMany({
            where: {
                timestamp: { gte: desde, lte: hasta },
                OR: [{ plateDetected: plate }, { plateNumber: plate }],
            },
            orderBy: { timestamp: "asc" },
            include: { device: { select: { name: true } } },
            take: 100,
        }),
        prisma.plateSighting.findMany({
            where: { plate, source: "TRACK", timestamp: { gte: desde, lte: hasta } },
            orderBy: { timestamp: "asc" },
            take: 100,
        }),
    ]);

    type Paso = {
        id: string;
        tipo: "ACCESO" | "PASO" | "ESTACIONADO";
        momento: string;
        camara: string | null;
        decision: string | null;
        sentido: string | null;
        confianza: number | null;
        foto: string | null;
        estDesde: string | null;
        estHasta: string | null;
        /** Segundos desde el paso anterior. El primero no tiene. */
        desdeAnterior: number | null;
    };

    const crudos: Omit<Paso, "desdeAnterior">[] = [
        ...accesos.map((a: any) => ({
            id: `a_${a.id}`,
            tipo: "ACCESO" as const,
            momento: a.timestamp.toISOString(),
            camara: a.device?.name || a.location || null,
            decision: a.decision || null,
            sentido: a.direction || null,
            confianza: null,
            foto: a.snapshotPath || a.imagePath || null,
            estDesde: null,
            estHasta: null,
        })),
        ...avistamientos.map((s: any) => ({
            id: `s_${s.id}`,
            tipo: (s.estado === "ESTACIONADO" ? "ESTACIONADO" : "PASO") as "PASO" | "ESTACIONADO",
            momento: s.timestamp.toISOString(),
            camara: s.cameraName || s.deviceId || null,
            decision: null,
            sentido: s.eventType || "INTERNAL",
            confianza: s.confidence ?? null,
            foto: s.snapshotUrl || null,
            estDesde: s.estDesde ? s.estDesde.toISOString() : null,
            estHasta: s.estHasta ? s.estHasta.toISOString() : null,
        })),
    ].sort((a, b) => a.momento.localeCompare(b.momento));

    const pasos: Paso[] = crudos.map((p, i) => ({
        ...p,
        desdeAnterior: i === 0
            ? null
            : Math.round((new Date(p.momento).getTime() - new Date(crudos[i - 1].momento).getTime()) / 1000),
    }));

    return NextResponse.json({
        plate,
        desde: desde.toISOString(),
        hasta: hasta.toISOString(),
        pasos,
        camaras: [...new Set(pasos.map((p) => p.camara).filter(Boolean))].length,
        duracion: pasos.length >= 2
            ? Math.round((new Date(pasos[pasos.length - 1].momento).getTime() - new Date(pasos[0].momento).getTime()) / 1000)
            : 0,
    });
}
