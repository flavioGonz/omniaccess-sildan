import { rpc2Sesion } from "@/lib/dahua-rpc2";
import { ZONA } from "@/lib/fechas";

/**
 * Salud de un NVR Dahua por RPC2 (change openspec nvr-dahua-wizsense, 12/11). Lo que el web V5
 * muestra en «Información del sistema»: CPU, memoria, hora del equipo, discos (por partición, sumados
 * por disco) y el estado de conexión de cada cámara (canal). Todo en paralelo y con tope corto; se
 * recuerda unos segundos por NVR porque la pantalla de Dispositivos pide la salud de cada cámara
 * colgada del NVR y todas salen de esta misma consulta.
 *
 * El firmware V5 deja colgada cualquier llamada con `params: null` (incluido el logout): acá todo va
 * con `{}` y el logout no se espera.
 */
export type DiscoDahua = { name: string; status: "ok" | "error"; capacityGB: number; usedPct: number; model: string | null; serial: string | null };
export type SaludDahua = {
    reachable: boolean; latencyMs: number | null; error?: string;
    cpuPct: number | null; memPct: number | null; memUsedMB: number | null; memTotalMB: number | null;
    uptimeSec: number | null; localTime: string | null; driftSec: number | null;
    disks: DiscoDahua[] | null; disksOk: boolean | null;
    /** Estado de cada canal, 1-based: "Connected" | "Disconnected" | … */
    canales: Record<number, string> | null;
    modelo: string | null; firmware: string | null;
};

const VIGENCIA_MS = 20_000;
const g = globalThis as unknown as { __saludDahua?: Map<string, { t: number; p: Promise<SaludDahua> }> };
const cache = (g.__saludDahua ??= new Map());

/** "YYYY-MM-DD HH:mm:ss" en la hora del barrio → epoch ms. */
function epochDeLocal(s: string): number | null {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/); if (!m) return null;
    const base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    const d = new Date(base);
    const off = new Date(d.toLocaleString("en-US", { timeZone: ZONA })).getTime() - new Date(d.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
    return base - off;
}

export function saludDahua(c: { ip: string; username?: string | null; password?: string | null }): Promise<SaludDahua> {
    const k = `${c.ip}|${c.username || "admin"}`;
    const ya = cache.get(k);
    if (ya && Date.now() - ya.t < VIGENCIA_MS) return ya.p;
    const p = consultar(c);
    cache.set(k, { t: Date.now(), p });
    p.catch(() => cache.delete(k));
    return p;
}

async function consultar(c: { ip: string; username?: string | null; password?: string | null }): Promise<SaludDahua> {
    const out: SaludDahua = { reachable: false, latencyMs: null, cpuPct: null, memPct: null, memUsedMB: null, memTotalMB: null, uptimeSec: null, localTime: null, driftSec: null, disks: null, disksOk: null, canales: null, modelo: null, firmware: null };
    const t0 = Date.now();
    let s;
    try { s = await rpc2Sesion({ ip: c.ip, username: c.username, password: c.password }, 8000); }
    catch (e: any) { out.error = e?.message || "sin respuesta"; return out; }
    out.reachable = true; out.latencyMs = Math.round((Date.now() - t0) / 3); // login = 2 idas y vueltas + hash
    const pedir = (m: string, p: any = {}) => s!.call(m, p).catch(() => null);
    try {
        const [cpu, mem, hora, disc, cams, tipo, ver] = await Promise.all([
            pedir("magicBox.getCPUUsage", { index: 0 }), pedir("magicBox.getMemoryInfo"), pedir("global.getCurrentTime"),
            pedir("storage.getDeviceAllInfo"), pedir("LogicDeviceManager.getCameraState", { uniqueChannels: [-1] }),
            pedir("magicBox.getDeviceType"), pedir("magicBox.getSoftwareVersion"),
        ]);
        if (cpu && typeof cpu.usage === "number") out.cpuPct = Math.round(cpu.usage);
        if (mem && Number(mem.total) > 0) {
            out.memTotalMB = Math.round(Number(mem.total) / 1048576);
            out.memUsedMB = Math.round((Number(mem.total) - Number(mem.free || 0)) / 1048576);
            out.memPct = Math.round((1 - Number(mem.free || 0) / Number(mem.total)) * 100);
        }
        if (hora?.time) {
            out.localTime = String(hora.time);
            const ms = epochDeLocal(out.localTime);
            if (ms != null) out.driftSec = Math.round((ms - Date.now()) / 1000);
        }
        if (disc && Array.isArray(disc.info)) {
            const discos: DiscoDahua[] = disc.info.map((d: any): DiscoDahua => {
                const parts: any[] = Array.isArray(d.Detail) ? d.Detail : [];
                const total = parts.reduce((a, x) => a + (Number(x.TotalBytes) || 0), 0);
                const usado = parts.reduce((a, x) => a + (Number(x.UsedBytes) || 0), 0);
                const error = d.State !== "Success" || parts.some((x) => x.IsError);
                return { name: String(d.Name || "").replace("/dev/", "") || "HDD", status: error ? "error" : "ok", capacityGB: Math.round(total / 1e9), usedPct: total ? Math.round((usado / total) * 100) : 0, model: null, serial: null };
            });
            out.disks = discos;
            out.disksOk = discos.length ? discos.every((d) => d.status === "ok") : null;
        }
        if (cams && Array.isArray(cams.states)) {
            out.canales = {};
            for (const x of cams.states) if (typeof x?.channel === "number") out.canales[x.channel + 1] = String(x.connectionState || "");
        }
        out.modelo = tipo?.type || null;
        out.firmware = ver?.version?.Version || null;
    } finally { s.close().catch(() => { }); }
    return out;
}
