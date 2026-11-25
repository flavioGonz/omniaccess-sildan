import { NextResponse } from "next/server";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { leerAjuste } from "@/lib/ajustes-db";
import { conexionDeCamara } from "@/lib/conexion-camaras";

export const dynamic = "force-dynamic";

/**
 * GET /api/lpr/lecturas-camara/estado — si cada cámara LPR está conectada, y su última lectura.
 * Liviana a propósito (la pantalla la pregunta cada 15 s): no aparea nada, sólo lee el estado que
 * deja camara-log y la hora del último evento de cada cámara. Ver lib/conexion-camaras.ts.
 */
export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("No es una vista de pantalla.");
    const [conRegistro, crudo] = await Promise.all([
        prisma.lecturaCamara.groupBy({ by: ["deviceId"], _max: { ts: true } }),
        leerAjuste("CAMARA_LOG_ESTADO"),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lo escribe camara-log.js
    let est: any = null;
    try { est = JSON.parse(crudo?.value || "null"); } catch { est = null; }
    const ids = conRegistro.map((c) => c.deviceId);
    const [nombres, ultimos] = await Promise.all([
        prisma.device.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
        prisma.accessEvent.groupBy({ by: ["deviceId"], where: { deviceId: { in: ids }, timestamp: { gte: new Date(Date.now() - 7 * 86400_000) } }, _max: { timestamp: true } }),
    ]);
    const nombre = new Map(nombres.map((d) => [d.id, d.name]));
    const ultimo = new Map(ultimos.map((u) => [u.deviceId, u._max.timestamp?.toISOString() || null]));
    const proceso = est?.t ? { t: String(est.t), cadaMs: Number(est.cadaMs) || 10_000 } : null;
    const camaras = conRegistro.map((c) => ({
        id: c.deviceId, nombre: nombre.get(c.deviceId) || c.deviceId,
        ...conexionDeCamara(est?.camaras?.[c.deviceId], proceso),
        ultimaCaptura: c._max.ts?.toISOString() || null,
        ultimoEvento: ultimo.get(c.deviceId) || null,
    })).sort((a, b) => a.nombre.localeCompare(b.nombre));
    return NextResponse.json({ proceso, camaras }, { headers: { "Cache-Control": "no-store" } });
}
