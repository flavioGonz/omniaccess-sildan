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
import { rpc2Sesion, rpc2Varios } from "@/lib/dahua-rpc2";

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

async function probeDahua(d: any, res: any) {
    const t0 = Date.now();
    try {
        await authenticatedRequest("GET", "/cgi-bin/magicBox.cgi?action=getSystemInfo", auth(d), { responseType: "text", timeout: 5000 });
        res.reachable = true; res.latencyMs = Date.now() - t0;
    } catch { res.reachable = false; return res; }
    const jobs: Promise<void>[] = [];
    jobs.push((async () => {
        try {
            const tr = await authenticatedRequest("GET", "/cgi-bin/global.cgi?action=getCurrentTime", auth(d), { responseType: "text", timeout: 4000 }); const m = /result=([\d\-: ]+)/.exec(tr);
            if (m) { res.localTime = m[1].trim(); const t = Date.parse(res.localTime.replace(" ", "T") + "-03:00"); if (!isNaN(t)) res.driftSec = Math.round((t - Date.now()) / 1000); }
        } catch { }
        try { const nt = await authenticatedRequest("GET", "/cgi-bin/configManager.cgi?action=getConfig&name=NTP", auth(d), { responseType: "text", timeout: 4000 }); res.timeMode = /\.Enable=true/i.test(nt) ? "NTP" : "manual"; } catch { }
    })());
    jobs.push((async () => {
        try {
            const txt = await authenticatedRequest("GET", "/cgi-bin/storageDevice.cgi?action=getDeviceAllInfo", auth(d), { responseType: "text", timeout: 6000 });
            const disks: any[] = [];
            const names = [...txt.matchAll(/list\.info\[(\d+)\]\.Name=(.+)/g)];
            for (const nm of names) {
                const idx = nm[1]; const name = String(nm[2]).trim();
                const stM = new RegExp("list\\.info\\[" + idx + "\\]\\.State=(\\w+)").exec(txt);
                const state = stM ? stM[1] : "";
                const err = new RegExp("list\\.info\\[" + idx + "\\]\\.Detail\\[\\d+\\]\\.IsError=true").test(txt);
                let tot = 0, used = 0, mm: any;
                const trx = new RegExp("list\\.info\\[" + idx + "\\]\\.Detail\\[\\d+\\]\\.TotalBytes=([\\d.]+)", "g");
                const urx = new RegExp("list\\.info\\[" + idx + "\\]\\.Detail\\[\\d+\\]\\.UsedBytes=([\\d.]+)", "g");
                while ((mm = trx.exec(txt))) tot += parseFloat(mm[1]);
                while ((mm = urx.exec(txt))) used += parseFloat(mm[1]);
                disks.push({ name, status: (state === "Success" && !err) ? "ok" : "error", model: "", serial: "", capacityGB: tot ? Math.round(tot / 1e9) : 0, usedPct: tot ? Math.round((used / tot) * 100) : 0 });
            }
            res.disks = disks;
        } catch { res.disks = []; }
    })());
    // NVR Dahua: CPU, memoria, red, canales y grabación por RPC2 (el CGI no los expone).
    if (d.deviceType === "NVR") jobs.push((async () => {
        let s: any = null;
        try {
            s = await rpc2Sesion(d, 6000);
            const r = await rpc2Varios(s, {
                cpu: ["magicBox.getCPUUsage", { part: 0 }], mem: ["magicBox.getMemoryInfo"], tipo: ["magicBox.getDeviceType"],
                ver: ["magicBox.getSoftwareVersion"], sn: ["magicBox.getSerialNo"], nombre: ["magicBox.getMachineName"],
                red: ["netApp.getNetInterfaces"], canales: ["LogicDeviceManager.getCameraState", { uniqueChannels: [-1] }],
                graba: ["recordManager.getState", { channel: 0 }], trafico: ["netApp.getNetDataStat", { Name: "eth0" }],
            });
            if (typeof r.cpu?.usage === "number") res.cpuPct = r.cpu.usage;
            if (r.mem?.total) { res.memTotalMB = Math.round(r.mem.total / 1048576); res.memUsedMB = Math.round((r.mem.total - r.mem.free) / 1048576); res.memPct = Math.round(((r.mem.total - r.mem.free) / r.mem.total) * 100); }
            if (r.tipo?.type) res.model = r.tipo.type;
            if (r.ver?.version) res.firmware = `${r.ver.version.Version || ""}${r.ver.version.BuildDate ? ` (${r.ver.version.BuildDate})` : ""}`;
            if (r.sn?.sn) res.serial = r.sn.sn;
            if (r.nombre?.name) res.machineName = r.nombre.name;
            const eth = (r.red?.netInterface || []).find((n: any) => n.ConnStatus === "Connected") || (r.red?.netInterface || [])[0];
            if (eth) { res.mac = eth.PhysicalAddress; res.linkMbps = eth.Speed; res.linkUp = eth.ConnStatus === "Connected"; }
            const st: any[] = r.canales?.states || [];
            if (st.length) {
                const usados = st.filter((c) => c.connectionState !== "Empty");
                res.channels = { total: st.length, usados: usados.length, conectados: usados.filter((c) => c.connectionState === "Connected").length, caidos: usados.filter((c) => c.connectionState !== "Connected").map((c) => c.channel + 1) };
            }
            if (typeof r.graba?.state === "boolean") res.recording = r.graba.state;
            if (r.trafico?.Receive) { res.rxGB = Math.round(r.trafico.Receive.bytes / 1e9); res.txGB = Math.round(r.trafico.Transmit?.bytes / 1e9); }
        } catch (e: any) { res.rpc2Error = e?.message || "RPC2 sin respuesta"; }
        finally { try { await s?.close(); } catch { } }
    })());
    await Promise.all(jobs);
    return res;
}

async function probe(d: any, streams: Record<string, { consumers: number; producers: number; configured: boolean }>) {
    const st = streams[`lpr_${d.id}`];
    const res: any = { id: d.id, name: d.name, deviceType: d.deviceType, brand: d.brand, ip: d.ip, reachable: false, latencyMs: null, viewers: st?.consumers ?? 0, streamConfigured: !!st?.configured, streamProducers: st?.producers ?? 0 };
    if (String(d.brand || "").toUpperCase().includes("DAHUA")) return probeDahua(d, res);
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
    const cpu = parseFloat(xmlField(statusXml, "cpuUtilization") || "");
    if (!isNaN(cpu)) res.cpuPct = Math.round(cpu);

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
            where: { brand: { in: ["HIKVISION", "DAHUA"] }, deviceType: { in: ["LPR_CAMERA", "NVR"] as any } },
            select: { id: true, name: true, ip: true, username: true, password: true, authType: true, deviceType: true, brand: true },
        });
        const streams = await go2rtcStreams();
        const results = await Promise.all(devices.map((d) => probe(d, streams).catch(() => ({ id: d.id, name: d.name, deviceType: d.deviceType, brand: d.brand, ip: d.ip, reachable: false }))));
        const map: Record<string, any> = {};
        for (const r of results) map[r.id] = r;
        return NextResponse.json({ ok: true, ts: Date.now(), devices: map });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "health failed" }, { status: 500 });
    }
}
