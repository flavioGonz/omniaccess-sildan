/**
 * GET /api/devices/health
 * Sondeo activo de todos los dispositivos LPR/NVR (Hikvision) por ISAPI:
 *  - reachable + latencyMs (estado real, no heurística de pull/push)
 *  - hora/NTP configurada + drift vs servidor
 *  - salud NVR: uptime, memoria %, discos (SMART/estado)
 *  - usuarios online (viewers que la plataforma sirve de cada cámara vía go2rtc)
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticatedRequest } from "@/lib/digest-auth";
import { xmlField } from "@/lib/isapi-camera";

export const dynamic = "force-dynamic";

const GO2RTC = process.env.GO2RTC_API || "http://127.0.0.1:1984";

function auth(d: any) {
    return { ip: d.ip, username: d.username, password: d.password, authType: d.authType || "DIGEST" };
}

async function go2rtcStreams(): Promise<Record<string, { consumers: number; producers: number; configured: boolean }>> {
    try {
        const r = await fetch(`${GO2RTC}/api/streams`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
        const j: any = await r.json();
        const out: Record<string, { consumers: number; producers: number; configured: boolean }> = {};
        for (const [name, info] of Object.entries<any>(j)) {
            const base = name.replace(/_hd$/, "");
            const cur = out[base] || { consumers: 0, producers: 0, configured: false };
            cur.configured = true;
            cur.consumers += Array.isArray(info?.consumers) ? info.consumers.length : 0;
            cur.producers += Array.isArray(info?.producers) ? info.producers.length : 0;
            out[base] = cur;
        }
        return out;
    } catch { return {}; }
}

async function probe(d: any, streams: Record<string, { consumers: number; producers: number; configured: boolean }>) {
    const st = streams[`lpr_${d.id}`];
    const res: any = { id: d.id, reachable: false, latencyMs: null, viewers: st?.consumers ?? 0, streamConfigured: !!st?.configured, streamProducers: st?.producers ?? 0 };
    // --- reachability + latencia + estado (System/status trae hora+uptime+mem en un tiro)
    const t0 = Date.now();
    let statusXml = "";
    try {
        statusXml = await authenticatedRequest("GET", "/ISAPI/System/status", auth(d), { responseType: "text", accept: "application/xml", timeout: 5000 });
        res.reachable = true;
        res.latencyMs = Date.now() - t0;
    } catch {
        res.reachable = false;
        return res;
    }
    // uptime + memoria
    const up = xmlField(statusXml, "deviceUpTime");
    if (up) res.uptimeSec = parseInt(up, 10);
    const memUse = parseFloat(xmlField(statusXml, "memoryUsage") || "");
    const memFree = parseFloat(xmlField(statusXml, "memoryAvailable") || "");
    if (!isNaN(memUse) && !isNaN(memFree) && memUse + memFree > 0) {
        res.memPct = Math.round((memUse / (memUse + memFree)) * 100);
        res.memUsedMB = Math.round(memUse);
        res.memTotalMB = Math.round(memUse + memFree);
    }
    const devTime = xmlField(statusXml, "currentDeviceTime");

    // --- hora / NTP (en paralelo con discos si NVR)
    const jobs: Promise<void>[] = [];
    jobs.push((async () => {
        try {
            const timeXml = await authenticatedRequest("GET", "/ISAPI/System/time", auth(d), { responseType: "text", accept: "application/xml", timeout: 4000 });
            res.timeMode = xmlField(timeXml, "timeMode"); // NTP | manual
            const local = xmlField(timeXml, "localTime") || devTime;
            res.localTime = local;
            if (local) {
                const t = Date.parse(local);
                if (!isNaN(t)) res.driftSec = Math.round((t - Date.now()) / 1000);
            }
        } catch { if (devTime) { res.localTime = devTime; const t = Date.parse(devTime); if (!isNaN(t)) res.driftSec = Math.round((t - Date.now()) / 1000); } }
    })());

    if (d.deviceType === "NVR") {
        jobs.push((async () => {
            try {
                const hddXml = await authenticatedRequest("GET", "/ISAPI/ContentMgmt/Storage/hdd", auth(d), { responseType: "text", accept: "application/xml", timeout: 5000 });
                const disks: any[] = [];
                const re = /<hdd>([\s\S]*?)<\/hdd>/gi; let m;
                while ((m = re.exec(hddXml))) {
                    const blk = m[1];
                    const status = xmlField(blk, "status");
                    if (status === "notexist") continue;
                    const cap = parseInt(xmlField(blk, "capacity") || "0", 10);
                    const free = parseInt(xmlField(blk, "freeSpace") || "0", 10);
                    disks.push({
                        name: xmlField(blk, "hddName"),
                        status, // ok = SMART sano
                        model: xmlField(blk, "hddModel"),
                        serial: xmlField(blk, "hddSerialNumber"),
                        capacityGB: cap ? Math.round(cap / 1024) : 0,
                        usedPct: cap ? Math.round(((cap - free) / cap) * 100) : 0,
                    });
                }
                res.disks = disks;
            } catch { res.disks = []; }
        })());
    }
    await Promise.all(jobs);
    return res;
}

export async function GET() {
    try {
        const devices = await prisma.device.findMany({
            where: { brand: "HIKVISION", deviceType: { in: ["LPR_CAMERA", "NVR", "LPR_INTERIOR"] as any } },
            select: { id: true, ip: true, username: true, password: true, authType: true, deviceType: true },
        });
        const streams = await go2rtcStreams();
        const results = await Promise.all(devices.map((d) => probe(d, streams).catch(() => ({ id: d.id, reachable: false }))));
        const map: Record<string, any> = {};
        for (const r of results) map[r.id] = r;
        return NextResponse.json({ ok: true, ts: Date.now(), devices: map });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "health failed" }, { status: 500 });
    }
}
