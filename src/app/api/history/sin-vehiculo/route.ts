/**
 * /api/history/sin-vehiculo?ids=a,b,c → { sinVehiculo: [ids], analizados: [ids] }
 *
 * Para los accesos que llegan en vivo al historial: una NO_LEIDA entra antes de que OmniVision la
 * mire (vision-relectura.js tarda unos segundos). La pantalla pregunta después qué resultaron: las
 * que fueron un disparo sin vehículo se sacan de la lista (o se rotulan, si se pidió verlas).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    const ids = (req.nextUrl.searchParams.get("ids") || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 100);
    if (!ids.length) return NextResponse.json({ sinVehiculo: [], analizados: [] });
    const [marcados, relecturas] = await Promise.all([
        prisma.accessEvent.findMany({ where: { id: { in: ids }, sinVehiculo: true }, select: { id: true } }),
        prisma.relectura.findMany({ where: { accessEventId: { in: ids }, NOT: { estado: "ERROR" } }, select: { accessEventId: true } }),
    ]);
    return NextResponse.json({ sinVehiculo: marcados.map((m) => m.id), analizados: relecturas.map((r) => r.accessEventId) }, { headers: { "Cache-Control": "no-store" } });
}
