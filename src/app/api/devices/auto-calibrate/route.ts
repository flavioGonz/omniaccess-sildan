/**
 * POST /api/devices/auto-calibrate?deviceId=...
 * Aplica el perfil ANPR "barrio abierto / nocturno" paso a paso y devuelve
 * el resultado de cada set para animar el proceso en la UI. Reversible.
 *
 * GET (mismo path) → devuelve la lista de pasos que se van a aplicar (para
 * mostrarlos antes de confirmar, sin tocar el equipo).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { BARRIO_NIGHT_PROFILE } from "@/lib/isapi-camera";

export const dynamic = "force-dynamic";

export async function GET() {
    return NextResponse.json({
        ok: true,
        steps: BARRIO_NIGHT_PROFILE.map((s) => ({ key: s.key, label: s.label, detail: s.detail })),
    });
}

export async function POST(req: NextRequest) {
    const id = req.nextUrl.searchParams.get("deviceId");
    if (!id) return NextResponse.json({ ok: false, error: "deviceId requerido" }, { status: 400 });
    const d = await prisma.device.findUnique({ where: { id }, select: { id: true, ip: true, username: true, password: true, authType: true, brand: true } });
    if (!d) return NextResponse.json({ ok: false, error: "device no existe" }, { status: 404 });
    if (d.brand !== "HIKVISION") return NextResponse.json({ ok: false, error: "auto-calibración sólo para Hikvision" }, { status: 400 });
    const dev = { ...d, authType: d.authType || "DIGEST" } as any;

    const results: any[] = [];
    for (const step of BARRIO_NIGHT_PROFILE) {
        try {
            await step.apply(dev);
            results.push({ key: step.key, label: step.label, detail: step.detail, ok: true });
        } catch (e: any) {
            results.push({ key: step.key, label: step.label, detail: step.detail, ok: false, error: e?.message || "falló" });
        }
    }
    const okCount = results.filter((r) => r.ok).length;
    return NextResponse.json({ ok: okCount > 0, applied: okCount, total: results.length, results });
}
