import { authenticatedRequest } from "@/lib/digest-auth";
import { xmlField } from "@/lib/isapi-camera";

/**
 * La salud de un NVR para su cabecera: si contesta, cuánto tarda, hace cuánto está prendido,
 * memoria y cada disco (estado, capacidad, ocupado). Hikvision por ISAPI; un Dahua devuelve
 * `null` en lo que no se sabe — no se inventa un «bien».
 */
export type Disco = { nombre: string; estado: string; capacidadGB: number; usadoPct: number; modelo: string | null };
export type SaludNvr = { alcanzable: boolean; latenciaMs: number | null; uptimeSec: number | null; memoriaPct: number | null; discos: Disco[] | null };

const TIEMPO_MS = 5000;

export async function saludNvr(d: { ip: string; username?: string | null; password?: string | null; authType?: string | null; brand?: string | null }): Promise<SaludNvr> {
    const dev: any = { ip: d.ip, username: d.username || "admin", password: d.password || "", authType: d.authType || "DIGEST" };
    const out: SaludNvr = { alcanzable: false, latenciaMs: null, uptimeSec: null, memoriaPct: null, discos: null };
    if (String(d.brand || "").toUpperCase() === "DAHUA") return out; // por CGI: pendiente
    const t0 = Date.now();
    let st = "";
    try {
        st = await authenticatedRequest("GET", "/ISAPI/System/status", dev, { responseType: "text", accept: "application/xml", timeout: TIEMPO_MS });
        out.alcanzable = true; out.latenciaMs = Date.now() - t0;
    } catch { return out; }
    const up = parseInt(xmlField(st, "deviceUpTime") || "", 10); if (!isNaN(up)) out.uptimeSec = up;
    const usada = parseFloat(xmlField(st, "memoryUsage") || ""), libre = parseFloat(xmlField(st, "memoryAvailable") || "");
    if (!isNaN(usada) && !isNaN(libre) && usada + libre > 0) out.memoriaPct = Math.round((usada / (usada + libre)) * 100);
    try {
        const xml = await authenticatedRequest("GET", "/ISAPI/ContentMgmt/Storage/hdd", dev, { responseType: "text", accept: "application/xml", timeout: TIEMPO_MS });
        const discos: Disco[] = [];
        // `<hdd version="1.0">`: con atributos (ver lib/device-health.ts, el NVR 6 figuraba sin discos).
        const re = /<hdd(?:\s[^>]*)?>([\s\S]*?)<\/hdd>/gi; let m: RegExpExecArray | null;
        while ((m = re.exec(xml))) {
            const estado = xmlField(m[1], "status") || "desconocido";
            if (estado === "notexist") continue;
            const cap = parseInt(xmlField(m[1], "capacity") || "0", 10), libreMb = parseInt(xmlField(m[1], "freeSpace") || "0", 10);
            discos.push({ nombre: xmlField(m[1], "hddName") || `HDD${discos.length + 1}`, estado, capacidadGB: cap ? Math.round(cap / 1024) : 0, usadoPct: cap ? Math.round(((cap - libreMb) / cap) * 100) : 0, modelo: xmlField(m[1], "hddModel") });
        }
        out.discos = discos;
    } catch { out.discos = null; }
    return out;
}

/**
 * Cuántos canales tiene el grabador, por su modelo: DS-7616 → 16, DS-9664 → 64, NVR5232 → 32.
 * Si el modelo no lo dice, el próximo tamaño estándar por encima del canal más alto que tiene.
 */
const TAMANOS = [4, 8, 16, 32, 64, 128, 256];
export function capacidadNvr(modelo: string | null | undefined, canalMax: number): number {
    const m = String(modelo || "");
    const hik = m.match(/DS-\d{2}(\d{2})N/i), dahua = m.match(/NVR\d{2}(\d{2})/i);
    const n = parseInt((hik || dahua)?.[1] || "", 10);
    if (n > 0 && n >= canalMax) return n;
    return TAMANOS.find((t) => t >= canalMax) || canalMax;
}
