export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor, SIN_CACHE } from "@/lib/monitor/servidor";
import { CLAVE_REGLAS } from "@/lib/vision-reglas";
import { capasDelCanal } from "@/lib/capas-canal";

/**
 * GET /api/monitor/camaras/capas?id=<id del equipo o nvrch-<nvr>-<ch>>
 *
 * Lo que las analíticas de ESE canal tienen dibujado (zonas y líneas de las reglas de OmniVision,
 * de las analíticas entrenables y de la lectura de matrículas), para mostrarlo sobre su vivo. El
 * porqué y los formatos, en src/lib/capas-canal.ts. Sólo lee.
 */
export async function GET(req: NextRequest) {
    const p = await autorizarMonitor("/api/monitor/camaras/capas");
    if (p.error) return p.error;
    const id = (req.nextUrl.searchParams.get("id") || "").slice(0, 120);
    if (!id) return NextResponse.json({ error: "falta el canal" }, { status: 400 });
    try {
        const [ajuste, zonas, equipo] = await Promise.all([
            prisma.setting.findUnique({ where: { key: CLAVE_REGLAS } }),
            prisma.zonaEntrenable.findMany({ where: { deviceId: id }, select: { id: true, nombre: true, deviceId: true, zona: true, positivo: true, negativo: true, activa: true, estado: true } }),
            // Un canal de grabador (nvrch-…) no es un equipo: no tiene lectura propia.
            id.startsWith("nvrch-") ? null : prisma.device.findUnique({ where: { id }, select: { deviceType: true, trackEnabled: true, trackRoi: true, trackLine: true } }),
        ]);
        return NextResponse.json(capasDelCanal(id, { reglas: ajuste?.value ?? null, zonas, equipo }), { headers: SIN_CACHE });
    } catch (e) {
        console.error("[monitor/camaras/capas]", e instanceof Error ? e.message : e);
        return NextResponse.json({ error: "no se pudieron leer las capas" }, { status: 500 });
    }
}
