import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { observar, estacionamientoPrendido, type VehiculoVisto } from "@/lib/estacionamiento";

export const dynamic = "force-dynamic";

/**
 * POST /api/tracking/franja/vision  { deviceId, ts, vehiculos: [{ caja:[x1,y1,x2,y2], clase, confianza, pista }] }
 *
 * Lo que vio OmniVision en una cámara con franja (vision-worker, cada ESTAC_CADA_MS). Entrada
 * interna: el worker manda el x-tracking-token, como el resto de /api/tracking. La decisión
 * —ocupa, sigue, libera— está en lib/estacionamiento.
 */
export async function POST(req: NextRequest) {
    const token = req.headers.get("x-tracking-token") || "";
    let esperado = process.env.TRACKING_TOKEN || "";
    if (!esperado) esperado = (await prisma.setting.findUnique({ where: { key: "TRACKING_TOKEN" } }).catch(() => null))?.value || "";
    if (!esperado || token !== esperado) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (!(await estacionamientoPrendido())) return NextResponse.json({ ok: false, motivo: "La analítica Estacionamiento está apagada" });
    const b = await req.json().catch(() => null);
    const deviceId = typeof b?.deviceId === "string" ? b.deviceId : "";
    const ts = Number(b?.ts) || Date.now();
    const vehiculos: VehiculoVisto[] = (Array.isArray(b?.vehiculos) ? b.vehiculos : [])
        .filter((v: any) => Array.isArray(v?.caja) && v.caja.length === 4 && v.caja.every((n: any) => Number.isFinite(Number(n))))
        .slice(0, 60)
        .map((v: any) => ({ caja: v.caja.map(Number), clase: String(v.clase || ""), confianza: Number(v.confianza) || 0, pista: v.pista ?? null }));
    if (!deviceId) return NextResponse.json({ error: "Falta deviceId" }, { status: 400 });
    await observar(deviceId, ts, vehiculos);
    return NextResponse.json({ ok: true });
}
