/**
 * Servidor de alarma (HTTP Host Notification) de cámaras Hikvision:
 * detecta si el equipo tiene a OmniAccess como destino de eventos y lo configura
 * si falta. OmniAccess ingesta en /api/webhooks/hikvision (proceso webhooks).
 *
 * ISAPI: GET/PUT /ISAPI/Event/notification/httpHosts  (lista)
 *        PUT /ISAPI/Event/notification/httpHosts/<id>  (un host)
 */
import { authenticatedRequest } from "@/lib/digest-auth";
import { prisma } from "@/lib/prisma";

export interface CamDev { ip: string; username?: string | null; password?: string | null; authType?: string | null; }
const dev = (d: CamDev): CamDev => ({ ...d, authType: d.authType || "DIGEST" });
const LIST = "/ISAPI/Event/notification/httpHosts";

export type AlarmHost = { id: string; url: string; ip: string; port: string };

export async function getEventTarget(): Promise<{ ip: string; port: string; path: string } | null> {
    const rows = await prisma.setting.findMany({ where: { key: { in: ["EVENT_HOST_IP", "EVENT_HOST_PORT", "EVENT_HOST_PATH"] } } });
    const cfg: any = {}; rows.forEach((r: any) => (cfg[r.key] = r.value));
    if (!cfg.EVENT_HOST_IP) return null;
    return { ip: cfg.EVENT_HOST_IP, port: cfg.EVENT_HOST_PORT || "10000", path: cfg.EVENT_HOST_PATH || "/api/webhooks/hikvision" };
}

function parseHosts(xml: string): AlarmHost[] {
    const out: AlarmHost[] = [];
    const re = /<HttpHostNotification[\s>]([\s\S]*?)<\/HttpHostNotification>/gi;
    let m;
    while ((m = re.exec(xml))) {
        const b = m[1];
        const g = (t: string) => (b.match(new RegExp(`<${t}>\\s*([^<]*?)\\s*</${t}>`, "i"))?.[1] || "").trim();
        out.push({ id: g("id"), url: g("url"), ip: g("ipAddress"), port: g("portNo") });
    }
    return out;
}

export async function readAlarmHosts(d: CamDev): Promise<{ ok: boolean; hosts: AlarmHost[]; hasOmni: boolean; error?: string }> {
    try {
        const xml: string = await authenticatedRequest("GET", LIST, dev(d), { responseType: "text", accept: "application/xml", timeout: 8000 });
        const hosts = parseHosts(String(xml || ""));
        const t = await getEventTarget();
        const hasOmni = !!t && hosts.some((h) => h.ip === t.ip && String(h.port) === String(t.port));
        return { ok: true, hosts, hasOmni };
    } catch (e: any) {
        return { ok: false, hosts: [], hasOmni: false, error: e?.message || "ISAPI error" };
    }
}

function hostBody(id: string, ip: string, port: string, path: string): string {
    return `<HttpHostNotification version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">` +
        `<id>${id}</id><url>${path}</url><protocolType>HTTP</protocolType>` +
        `<parameterFormatType>XML</parameterFormatType><addressingFormatType>ipaddress</addressingFormatType>` +
        `<ipAddress>${ip}</ipAddress><portNo>${port}</portNo>` +
        `<httpAuthenticationMethod>none</httpAuthenticationMethod></HttpHostNotification>`;
}

/** Asegura que OmniAccess sea servidor de alarma del equipo (lo agrega si falta). */
export async function ensureAlarmHost(d: CamDev): Promise<{ ok: boolean; already?: boolean; slot?: string; error?: string }> {
    const t = await getEventTarget();
    if (!t) return { ok: false, error: "Falta configurar el host de eventos de OmniAccess (Settings EVENT_HOST_IP)." };
    const cur = await readAlarmHosts(d);
    if (!cur.ok) return { ok: false, error: cur.error };
    if (cur.hasOmni) return { ok: true, already: true };
    // elegir slot: primero uno vacío (0.0.0.0), si no el siguiente id
    let slot = cur.hosts.find((h) => !h.ip || h.ip === "0.0.0.0")?.id;
    if (!slot) {
        const maxId = cur.hosts.reduce((mx, h) => Math.max(mx, parseInt(h.id || "0") || 0), 0);
        slot = String(maxId + 1);
    }
    try {
        await authenticatedRequest("PUT", `${LIST}/${slot}`, dev(d), { data: hostBody(slot, t.ip, t.port, t.path), contentType: "application/xml", responseType: "text", timeout: 9000 });
        return { ok: true, slot };
    } catch (e: any) {
        return { ok: false, error: e?.message || "ISAPI PUT error" };
    }
}


/** Dispara el test de notificación del equipo hacia el host OmniAccess (ISAPI .../test). */
export async function testAlarmHost(d: CamDev): Promise<{ ok: boolean; reporting?: boolean; error?: string }> {
    const t = await getEventTarget();
    if (!t) return { ok: false, error: "Falta EVENT_HOST_IP" };
    const cur = await readAlarmHosts(d);
    if (!cur.ok) return { ok: false, error: cur.error };
    const host = cur.hosts.find((h) => h.ip === t.ip && String(h.port) === String(t.port));
    if (!host) return { ok: false, error: "OmniAccess no está configurado como servidor de alarma" };
    try {
        const xml: string = await authenticatedRequest("POST", `${LIST}/${host.id}/test`, dev(d), { responseType: "text", accept: "application/xml", timeout: 9000 });
        const ok = /statusString>\s*OK|<statusCode>\s*1/i.test(String(xml || ""));
        return { ok: true, reporting: ok };
    } catch (e: any) {
        return { ok: false, error: e?.message || "El equipo no aceptó el test" };
    }
}
