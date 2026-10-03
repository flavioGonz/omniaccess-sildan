"use server";

import { prisma } from "@/lib/prisma";
import { authenticatedRequest } from "@/lib/digest-auth";
import { getChannelMap } from "@/lib/nvr-resolve";

// Canal del NVR para una cámara (compat: solo número).
export async function getNvrChannel(deviceId?: string | null): Promise<number | null> {
    if (!deviceId) return null;
    try {
        const dev = await prisma.device.findUnique({ where: { id: deviceId }, select: { ip: true } });
        if (!dev?.ip) return null;
        const map = await getChannelMap();
        const e = map[dev.ip];
        return e?.ch != null ? Number(e.ch) : null;
    } catch {
        return null;
    }
}

// Canal + NVR para una cámara.
export async function getNvrChannelInfo(deviceId?: string | null): Promise<{ ch: number; nvr: string | null } | null> {
    if (!deviceId) return null;
    try {
        const dev = await prisma.device.findUnique({ where: { id: deviceId }, select: { ip: true } });
        if (!dev?.ip) return null;
        const map = await getChannelMap();
        const e = map[dev.ip];
        return e ? { ch: e.ch, nvr: e.nvrId } : null;
    } catch {
        return null;
    }
}

// Lista de NVR dados de alta (dispositivos tipo NVR).
export async function getNvrList(): Promise<{ id: string; name: string; ip: string }[]> {
    try {
        const devs = await prisma.device.findMany({ where: { deviceType: "NVR" }, select: { id: true, name: true, ip: true }, orderBy: { createdAt: "asc" } });
        return devs.map((d) => ({ id: d.id, name: d.name, ip: d.ip }));
    } catch {
        return [];
    }
}

// Lee los canales configurados de un NVR vía ISAPI (InputProxy) -> [{channel, ip, name}]
export async function getNvrChannels(input: { ip: string; username?: string; password?: string; authType?: string }) {
    const rows = await prisma.setting.findMany({ where: { key: { in: ["NVR_HOST", "NVR_USER", "NVR_PASS"] } } });
    const cfg: any = {}; rows.forEach((r: any) => (cfg[r.key] = r.value));
    const ip = (input.ip || cfg.NVR_HOST || "").trim();
    if (!ip) return { ok: false, error: "IP requerida", channels: [] as any[] };

    const creds: { username: string; password: string }[] = [];
    if ((input.username && input.username.length) || (input.password && input.password.length)) {
        creds.push({ username: input.username || "admin", password: input.password || "" });
    }
    if (cfg.NVR_USER || cfg.NVR_PASS) {
        const c = { username: cfg.NVR_USER || "admin", password: cfg.NVR_PASS || "" };
        if (!creds.some((x) => x.username === c.username && x.password === c.password)) creds.push(c);
    }
    if (creds.length === 0) creds.push({ username: "admin", password: "" });

    let lastErr = "";
    for (const cred of creds) {
        for (const a of ["DIGEST", "BASIC"]) {
            try {
                const dev: any = { ip, username: cred.username, password: cred.password, authType: a };
                const xml: string = await authenticatedRequest("GET", "/ISAPI/ContentMgmt/InputProxy/channels", dev, { responseType: "text", accept: "application/xml", contentType: "application/xml" });
                const channels = parseInputProxy(String(xml || ""));
                if (channels.length) {
                    const estado = await leerEstadoCanales(dev);
                    for (const c of channels) if (c.channel in estado) c.online = estado[c.channel];
                    return { ok: true, authType: a, channels };
                }
            } catch (e: any) { lastErr = e?.message || String(e); }
        }
    }
    return { ok: false, error: lastErr || "Sin respuesta ISAPI del NVR", channels: [] as any[] };
}

export type CanalNvr = { channel: number; ip: string | null; name: string | null; model: string | null; online: boolean | null };

// El tag puede venir pelado (`<InputProxyChannel>`, fw V4.63) o con atributos
// (`<InputProxyChannel version="1.0" xmlns=...>`, fw V4.83 de los NXI): por eso se parte por
// `[\s>]` y no por el tag exacto. Verificado contra los dos NVR de San Nicolás.
function parseInputProxy(xml: string): CanalNvr[] {
    const out: CanalNvr[] = [];
    const blocks = xml.split(/<InputProxyChannel[\s>]/i).slice(1);
    for (const b of blocks) {
        const idM = b.match(/<id>\s*(\d+)\s*<\/id>/i);
        const ipM = b.match(/<ipAddress>\s*([0-9.]+)\s*<\/ipAddress>/i);
        const nmM = b.match(/<name>\s*([^<]*)\s*<\/name>/i);
        const mdM = b.match(/<model>\s*([^<]*)\s*<\/model>/i);
        if (idM) out.push({ channel: parseInt(idM[1]), ip: ipM ? ipM[1] : null, name: nmM ? nmM[1].trim() : null, model: mdM ? mdM[1].trim() : null, online: null });
    }
    return out;
}

// El estado en línea NO viene en /channels: vive en /channels/status. Se consulta aparte y
// se cruza por id; si falla, el canal queda con online=null (desconocido), no false.
async function leerEstadoCanales(dev: any): Promise<Record<number, boolean>> {
    try {
        const xml: string = await authenticatedRequest("GET", "/ISAPI/ContentMgmt/InputProxy/channels/status", dev, { responseType: "text", accept: "application/xml", contentType: "application/xml" });
        const estado: Record<number, boolean> = {};
        for (const b of String(xml || "").split(/<InputProxyChannelStatus[\s>]/i).slice(1)) {
            const idM = b.match(/<id>\s*(\d+)\s*<\/id>/i);
            const onM = b.match(/<online>\s*(true|false)\s*<\/online>/i);
            if (idM && onM) estado[parseInt(idM[1])] = onM[1].toLowerCase() === "true";
        }
        return estado;
    } catch { return {}; }
}

// Compat: mapa cámara->canal (solo número). Para el editor de mapeo con NVR usar getNvrChannelMapFull.
export async function getNvrChannelMap(): Promise<Record<string, number>> {
    const m = await getChannelMap();
    const out: Record<string, number> = {};
    for (const k of Object.keys(m)) out[k] = m[k].ch;
    return out;
}

// Mapa completo cámara->{nvr,ch}.
export async function getNvrChannelMapFull(): Promise<Record<string, { nvr: string | null; ch: number }>> {
    const m = await getChannelMap();
    const out: Record<string, { nvr: string | null; ch: number }> = {};
    for (const k of Object.keys(m)) out[k] = { nvr: m[k].nvrId, ch: m[k].ch };
    return out;
}

// Guarda el mapeo de UN NVR (identificado por su IP): reemplaza solo las cámaras de ese NVR
// y conserva las de los demás NVR. entries = { ipCámara: canal }.
export async function saveNvrChannelMapForNvr(nvrIp: string, entries: Record<string, number | string>): Promise<{ ok: boolean; nvr: string | null }> {
    try {
        const nvr = await prisma.device.findFirst({ where: { deviceType: "NVR", ip: (nvrIp || "").trim() }, select: { id: true } });
        const nvrId = nvr?.id ?? null;
        const full = await getChannelMap(); // { ip: {nvrId, ch} }
        const merged: Record<string, { nvr: string | null; ch: number }> = {};
        // conservar entradas de OTROS NVR
        for (const k of Object.keys(full)) {
            if (full[k].nvrId !== nvrId) merged[k] = { nvr: full[k].nvrId, ch: full[k].ch };
        }
        // agregar/actualizar las de ESTE NVR
        for (const k of Object.keys(entries || {})) {
            const ch = Number(entries[k]);
            if (k && !isNaN(ch) && ch > 0) merged[k] = { nvr: nvrId, ch };
        }
        await prisma.setting.upsert({
            where: { key: "NVR_CHANNEL_MAP" },
            update: { value: JSON.stringify(merged) },
            create: { key: "NVR_CHANNEL_MAP", value: JSON.stringify(merged) },
        });
        return { ok: true, nvr: nvrId };
    } catch { return { ok: false, nvr: null }; }
}

// Guarda el mapa. Acepta {ip: canal} (compat) o {ip: {nvr, ch}}; almacena normalizado {ip: {nvr, ch}}.
export async function saveNvrChannelMap(
    map: Record<string, number | string | { nvr?: string | null; ch: number | string }>
): Promise<{ ok: boolean }> {
    try {
        const clean: Record<string, { nvr: string | null; ch: number }> = {};
        for (const k of Object.keys(map || {})) {
            const v: any = map[k];
            let ch: number; let nvr: string | null = null;
            if (v && typeof v === "object") { ch = Number(v.ch); nvr = v.nvr ?? v.nvrId ?? null; }
            else ch = Number(v);
            if (k && !isNaN(ch) && ch > 0) clean[k] = { nvr, ch };
        }
        await prisma.setting.upsert({
            where: { key: "NVR_CHANNEL_MAP" },
            update: { value: JSON.stringify(clean) },
            create: { key: "NVR_CHANNEL_MAP", value: JSON.stringify(clean) },
        });
        return { ok: true };
    } catch { return { ok: false }; }
}

// ── Importar canales de un NVR como cámaras ───────────────────────────────────
// Lo que Olivos hizo a mano en la base (79 canales) acá es una acción. Cada canal elegido
// pasa a ser un Device tipo CAMERA con las credenciales del NVR, queda mapeado {nvr, ch} en
// NVR_CHANNEL_MAP (formato nuevo) y con su stream en go2rtc (rama CAMERA: HD vía NVR).
// Idempotente por IP: un canal ya importado se actualiza, no se duplica.
export async function importarCanalesNvr(nvrDeviceId: string, canales: number[]): Promise<{
    ok: boolean; error?: string; creadas: number; actualizadas: number; detalle: { channel: number; ip: string | null; name: string; accion: "creada" | "actualizada" | "omitida"; motivo?: string }[];
}> {
    const detalle: { channel: number; ip: string | null; name: string; accion: "creada" | "actualizada" | "omitida"; motivo?: string }[] = [];
    try {
        const nvr = await prisma.device.findUnique({ where: { id: nvrDeviceId } });
        if (!nvr || (nvr.deviceType as any) !== "NVR" || !nvr.ip) return { ok: false, error: "El NVR no existe o no tiene IP", creadas: 0, actualizadas: 0, detalle };

        const res = await getNvrChannels({ ip: nvr.ip, username: nvr.username || undefined, password: nvr.password || undefined, authType: (nvr.authType as any) || undefined });
        if (!res.ok) return { ok: false, error: res.error || "No se pudieron leer los canales", creadas: 0, actualizadas: 0, detalle };

        const elegidos = (res.channels as CanalNvr[]).filter((c) => canales.includes(c.channel));
        const mapa: Record<string, number> = {};
        let creadas = 0, actualizadas = 0;

        for (const c of elegidos) {
            if (!c.ip) { detalle.push({ channel: c.channel, ip: null, name: c.name || "", accion: "omitida", motivo: "el canal no tiene IP" }); continue; }
            // El nombre del NVR suele ser el bueno ("Sector 9 z2 - c1"); si viene vacío se arma uno.
            const name = (c.name && c.name.trim()) || `${nvr.name} · ch ${c.channel}`;
            const datos: any = {
                name, ip: c.ip,
                brand: nvr.brand, deviceType: "CAMERA",
                username: nvr.username, password: nvr.password, authType: nvr.authType,
                deviceModel: c.model || undefined,
            };
            const existente = await prisma.device.findFirst({ where: { ip: c.ip } });
            let dev;
            if (existente) {
                // Si ya es una cámara nuestra se refresca; si es otro tipo (LPR, interior) no se le
                // cambia el tipo: se avisa y se mapea igual, que es lo que sirve para el vivo.
                const cambiaTipo = (existente.deviceType as any) !== "CAMERA";
                dev = cambiaTipo ? existente : await prisma.device.update({ where: { id: existente.id }, data: { name: existente.name || name, deviceModel: datos.deviceModel } });
                detalle.push({ channel: c.channel, ip: c.ip, name: dev.name, accion: "actualizada", motivo: cambiaTipo ? `ya existía como ${existente.deviceType}; sólo se mapeó` : undefined });
                actualizadas++;
            } else {
                dev = await prisma.device.create({ data: datos });
                detalle.push({ channel: c.channel, ip: c.ip, name: dev.name, accion: "creada" });
                creadas++;
            }
            mapa[c.ip] = c.channel;
            try { const { syncLprStream } = await import("@/lib/go2rtc-sync"); await syncLprStream(dev as any); } catch (e) { console.error("[importarCanalesNvr] go2rtc:", (e as any)?.message); }
        }

        if (Object.keys(mapa).length) await saveNvrChannelMapForNvr(nvr.ip, mapa);
        return { ok: true, creadas, actualizadas, detalle };
    } catch (e: any) {
        return { ok: false, error: e?.message || String(e), creadas: 0, actualizadas: 0, detalle };
    }
}
