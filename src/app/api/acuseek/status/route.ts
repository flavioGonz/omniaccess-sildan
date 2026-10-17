/** GET /api/acuseek/status — estado en vivo de AcuSeek + ejemplos, recientes y cámaras del NVR */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAcuSeekStatus, getExampleTerms, getHistoricalTerms } from "@/lib/acuseek";
import { nvrConAcuSeek, camarasDelNvr, conSesion, SIN_ACUSEEK } from "@/lib/acuseek-nvr";

export async function GET() {
    const no = await conSesion(); if (no) return no;
    try {
        const acu = await nvrConAcuSeek();
        if (!acu) return NextResponse.json({ ok: false, sinAcuSeek: true, error: SIN_ACUSEEK }, { status: 404 });
        const nvr = (await prisma.device.findUnique({ where: { id: acu.id }, select: { id: true, name: true, ip: true, deviceModel: true } }))!;
        const device = acu.dev;

        const status = await getAcuSeekStatus(device);

        // extras solo si está activo
        let examples: string[] = [], recent: string[] = [], cameras: { channel: number; name: string }[] = [];
        if (status.activated) {
            [examples, recent] = await Promise.all([getExampleTerms(device), getHistoricalTerms(device)]);
            // cámaras de ESTE grabador (canal → nombre del equipo en OmniAccess)
            try {
                const cams = await camarasDelNvr(acu.id);
                cameras = Object.keys(cams).map(Number).sort((a, b) => a - b).map((ch) => ({ channel: ch, name: cams[ch].nombre }));
            } catch { /* best-effort */ }
        }

        return NextResponse.json({ ok: true, nvr: { id: nvr.id, name: nvr.name, ip: nvr.ip, model: nvr.deviceModel }, ...status, examples, recent, cameras }, { headers: { "Cache-Control": "no-store" } });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "acuseek status error" }, { status: 500 });
    }
}
