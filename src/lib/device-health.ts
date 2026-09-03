/**
 * Sondeo de salud + persistencia histórica + evaluación de alertas.
 * Lo llama el tick por minuto (/api/devices/health/tick) para tener historia y
 * alertas 24/7 sin depender de que el navegador tenga la página abierta.
 */
import { prisma } from "@/lib/prisma";
import { authenticatedRequest } from "@/lib/digest-auth";
import { xmlField } from "@/lib/isapi-camera";
import { sendTelegramMessage } from "@/lib/telegram";

const GO2RTC = process.env.GO2RTC_API || "http://127.0.0.1:1984";

export interface HealthResult {
    id: string; name: string; deviceType: string; ip: string;
    reachable: boolean; latencyMs: number | null;
    memPct: number | null; uptimeSec: number | null; driftSec: number | null;
    disksOk: boolean | null; viewers: number;
    vcaMode: string | null;   // cámaras LPR: 'roadDetection' = ANPR activo; 'smart' = el NVR le robó el motor (AcuSearch/eventos) y NO lee matrículas
}

function auth(d: any) { return { ip: d.ip, username: d.username, password: d.password, authType: d.authType || "DIGEST" }; }

async function go2rtcViewers(): Promise<Record<string, number>> {
    try {
        const r = await fetch(`${GO2RTC}/api/streams`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
        const j: any = await r.json();
        const out: Record<string, number> = {};
        for (const [name, info] of Object.entries<any>(j)) {
            const base = name.replace(/_hd$/, "");
            out[base] = (out[base] || 0) + (Array.isArray(info?.consumers) ? info.consumers.length : 0);
        }
        return out;
    } catch { return {}; }
}

async function probe(d: any, viewers: Record<string, number>): Promise<HealthResult> {
    const res: HealthResult = {
        id: d.id, name: d.name, deviceType: d.deviceType, ip: d.ip,
        reachable: false, latencyMs: null, memPct: null, uptimeSec: null,
        driftSec: null, disksOk: null, viewers: viewers[`lpr_${d.id}`] ?? 0, vcaMode: null,
    };
    const t0 = Date.now();
    let statusXml = "";
    try {
        statusXml = await authenticatedRequest("GET", "/ISAPI/System/status", auth(d), { responseType: "text", accept: "application/xml", timeout: 5000 });
        res.reachable = true;
        res.latencyMs = Date.now() - t0;
    } catch { return res; }

    const up = xmlField(statusXml, "deviceUpTime"); if (up) res.uptimeSec = parseInt(up, 10);
    const memUse = parseFloat(xmlField(statusXml, "memoryUsage") || "");
    const memFree = parseFloat(xmlField(statusXml, "memoryAvailable") || "");
    if (!isNaN(memUse) && !isNaN(memFree) && memUse + memFree > 0) res.memPct = Math.round((memUse / (memUse + memFree)) * 100);
    const devTime = xmlField(statusXml, "currentDeviceTime");

    const jobs: Promise<void>[] = [];
    jobs.push((async () => {
        try {
            const timeXml = await authenticatedRequest("GET", "/ISAPI/System/time", auth(d), { responseType: "text", accept: "application/xml", timeout: 4000 });
            const local = xmlField(timeXml, "localTime") || devTime;
            if (local) { const t = Date.parse(local); if (!isNaN(t)) res.driftSec = Math.round((t - Date.now()) / 1000); }
        } catch { if (devTime) { const t = Date.parse(devTime); if (!isNaN(t)) res.driftSec = Math.round((t - Date.now()) / 1000); } }
    })());
    if (d.deviceType === "LPR_CAMERA") {
        // Modo del recurso inteligente: debe ser roadDetection. Al activar AcuSearch/eventos por canal en el NVR,
        // las iDS-2CD7A46 pasan a "smart" y dejan de leer matrículas (incidente 2026-09-02, 20 h sin capturas).
        jobs.push((async () => {
            try {
                const vca = await authenticatedRequest("GET", "/ISAPI/System/Video/inputs/channels/1/VCAResource", auth(d), { responseType: "text", accept: "application/xml", timeout: 4000 });
                res.vcaMode = xmlField(vca, "type") || null;
            } catch { res.vcaMode = null; }
        })());
    }
    if (d.deviceType === "NVR") {
        jobs.push((async () => {
            try {
                const hddXml = await authenticatedRequest("GET", "/ISAPI/ContentMgmt/Storage/hdd", auth(d), { responseType: "text", accept: "application/xml", timeout: 5000 });
                const re = /<hdd>([\s\S]*?)<\/hdd>/gi; let m; let any = false; let allOk = true;
                while ((m = re.exec(hddXml))) {
                    const st = xmlField(m[1], "status");
                    if (st === "notexist") continue;
                    any = true; if (st !== "ok") allOk = false;
                }
                res.disksOk = any ? allOk : null;
            } catch { res.disksOk = null; }
        })());
    }
    await Promise.all(jobs);
    return res;
}

export async function probeAllDevices(): Promise<HealthResult[]> {
    const devices = await prisma.device.findMany({
        where: { brand: "HIKVISION", deviceType: { in: ["LPR_CAMERA", "NVR"] as any } },
        select: { id: true, name: true, ip: true, username: true, password: true, authType: true, deviceType: true },
    });
    const viewers = await go2rtcViewers();
    return Promise.all(devices.map((d) => probe(d, viewers).catch((): HealthResult => ({
        id: d.id, name: d.name, deviceType: d.deviceType, ip: d.ip, reachable: false,
        latencyMs: null, memPct: null, uptimeSec: null, driftSec: null, disksOk: null, viewers: 0, vcaMode: null,
    }))));
}

// ── Reglas de alerta ──
const MEM_OPEN = 95, MEM_CLOSE = 90, DRIFT_LIMIT = 120;

async function ensureAlert(deviceId: string, name: string, type: string, severity: string, message: string) {
    const existing = await prisma.deviceAlert.findFirst({ where: { deviceId, type, active: true } });
    if (existing) return;
    await prisma.deviceAlert.create({ data: { deviceId, type, severity, message, active: true } });
    const icon = severity === "critical" ? "🔴" : "🟠";
    await sendTelegramMessage(`${icon} <b>ALERTA · ${name}</b>\n${message}`).catch(() => { });
}
async function resolveAlert(deviceId: string, name: string, type: string) {
    const existing = await prisma.deviceAlert.findFirst({ where: { deviceId, type, active: true } });
    if (!existing) return;
    await prisma.deviceAlert.update({ where: { id: existing.id }, data: { active: false, resolvedAt: new Date() } });
    await sendTelegramMessage(`🟢 <b>NORMALIZADO · ${name}</b>\n${type === "offline" ? "Volvió a responder" : "Condición resuelta (" + type + ")"}`).catch(() => { });
}

export async function persistAndAlert(results: HealthResult[]) {
    for (const r of results) {
        // muestra previa (para anti-flap de offline)
        const prev = await prisma.deviceHealthSample.findFirst({ where: { deviceId: r.id }, orderBy: { ts: "desc" }, select: { reachable: true } }).catch(() => null);
        await prisma.deviceHealthSample.create({
            data: { deviceId: r.id, reachable: r.reachable, latencyMs: r.latencyMs ?? undefined, memPct: r.memPct ?? undefined, uptimeSec: r.uptimeSec ?? undefined, driftSec: r.driftSec ?? undefined, disksOk: r.disksOk ?? undefined, viewers: r.viewers },
        }).catch(() => { });

        // OFFLINE (2 muestras seguidas sin respuesta, para no titilar)
        if (!r.reachable) {
            if (prev && prev.reachable === false) await ensureAlert(r.id, r.name, "offline", "critical", "Sin respuesta ISAPI (offline)");
        } else {
            await resolveAlert(r.id, r.name, "offline");
            // DISCO (NVR)
            if (r.disksOk === false) await ensureAlert(r.id, r.name, "disk", "critical", "Disco del NVR degradado / SMART no OK");
            else if (r.disksOk === true) await resolveAlert(r.id, r.name, "disk");
            // MEMORIA (NVR) con histéresis
            if (r.memPct != null && r.memPct >= MEM_OPEN) await ensureAlert(r.id, r.name, "mem", "warning", `Memoria del NVR alta (${r.memPct}%)`);
            else if (r.memPct != null && r.memPct < MEM_CLOSE) await resolveAlert(r.id, r.name, "mem");
            // DRIFT de reloj
            if (r.driftSec != null && Math.abs(r.driftSec) > DRIFT_LIMIT) await ensureAlert(r.id, r.name, "drift", "warning", `Reloj desfasado ${r.driftSec > 0 ? "+" : ""}${r.driftSec}s vs servidor`);
            else if (r.driftSec != null && Math.abs(r.driftSec) <= DRIFT_LIMIT) await resolveAlert(r.id, r.name, "drift");
            // MODO VCA (cámaras LPR): si no está en roadDetection, el ANPR está apagado
            if (r.deviceType === "LPR_CAMERA" && r.vcaMode) {
                if (r.vcaMode !== "roadDetection") await ensureAlert(r.id, r.name, "vca", "critical", `ANPR apagado: recurso inteligente en modo "${r.vcaMode}" (debe ser roadDetection). Suele pasar al activar AcuSearch/eventos en el canal del NVR. Fix: PUT VCAResource type=roadDetection + reboot.`);
                else await resolveAlert(r.id, r.name, "vca");
            }
        }
    }
    // Poda: 1 vez por hora, samples > 14 días
    if (new Date().getMinutes() === 3) {
        const cutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000);
        await prisma.deviceHealthSample.deleteMany({ where: { ts: { lt: cutoff } } }).catch(() => { });
    }
}
