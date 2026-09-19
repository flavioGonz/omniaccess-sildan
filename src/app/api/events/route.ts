import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/events?plate=XXX&limit=10
 *
 * Los últimos accesos de una matrícula. Lo consume el mapa para saber por dónde entró un
 * vehículo antes de dibujar su salida.
 *
 * Dos cosas que faltaban y son del mismo error, no de dos:
 *
 *   No pedía sesión. Cualquiera con la URL podía preguntar por una matrícula y recibir el
 *   historial de accesos de ese vehículo — a qué hora entra y sale una persona de su casa,
 *   que es exactamente el dato que este sistema existe para cuidar.
 *
 *   Devolvía el correo del titular. El mapa nunca lo usó: venía en el `include` porque
 *   estaba a mano. Un campo que nadie pide no se manda, y menos por un endpoint que
 *   además estaba abierto.
 */
export async function GET(request: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    try {
        const searchParams = request.nextUrl.searchParams;
        const plate = (searchParams.get("plate") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "10", 10) || 10, 1), 100);

        if (!plate) {
            return NextResponse.json({ error: "Plate parameter is required" }, { status: 400 });
        }

        const events = await prisma.accessEvent.findMany({
            where: { plateDetected: plate },
            include: {
                device: { select: { id: true, name: true, location: true } },
                user: { select: { id: true, name: true } },
            },
            orderBy: { timestamp: "desc" },
            take: limit,
        });

        return NextResponse.json({ events });
    } catch (error) {
        console.error("Error fetching events:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
