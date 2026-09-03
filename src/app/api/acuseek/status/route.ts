/** GET /api/acuseek/status — estado en vivo de AcuSeek + ejemplos, recientes y cámaras del NVR */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAcuSeekStatus, getExampleTerms, getHistoricalTerms } from "@/lib/acuseek";

export async function GET() {
    try {
        const nvr = await prisma.device.findFirst({ where: { deviceType: "NVR" }, select: { id: true, name: true, ip: true, username: true, password: true, deviceModel: true, authType: true } });
        if (!nvr?.ip) return NextResponse.json({ ok: false, error: "No hay NVR configurado." }, { status: 404 });
        const device = { ip: nvr.ip, username: nvr.username || "admin", password: nvr.password || "", authType: nvr.authType || "DIGEST" };

        const status = await getAcuSeekStatus(device);

        // extras solo si está activo
        let examples: string[] = [], recent: string[] = [], cameras: { channel: number; name: string }[] = [];
        if (status.activated) {
            [examples, recent] = await Promise.all([getExampleTerms(device), getHistoricalTerms(device)]);
            // cámaras mapeadas (canal → nombre del device OmniAccess, si existe)
            try {
                const row = await prisma.setting.findUnique({ where: { key: "NVR_CHANNEL_MAP" } });
                const map = row?.value ? JSON.parse(row.value) as Record<string, number | string> : {};
                const chToIp: Record<number, string> = {};
                for (const [ip, ch] of Object.entries(map)) chToIp[Number(ch)] = ip;
                const ips = Array.from(new Set(Object.values(chToIp)));
                const devs = ips.length ? await prisma.device.findMany({ where: { ip: { in: ips } }, select: { name: true, ip: true } }) : [];
                const byIp: Record<string, string> = {}; for (const d of devs) byIp[d.ip!] = d.name;
                cameras = Object.keys(chToIp).map(Number).sort((a, b) => a - b).map(ch => ({ channel: ch, name: byIp[chToIp[ch]] || `Canal ${ch}` }));
            } catch { /* best-effort */ }
        }

        return NextResponse.json({ ok: true, nvr: { id: nvr.id, name: nvr.name, ip: nvr.ip, model: nvr.deviceModel }, ...status, examples, recent, cameras }, { headers: { "Cache-Control": "no-store" } });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "acuseek status error" }, { status: 500 });
    }
}
