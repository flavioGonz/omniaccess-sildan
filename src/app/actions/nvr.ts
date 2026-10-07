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

    // Marca del NVR (por IP): Dahua no habla ISAPI → lee los canales por CGI.
    let nvrBrand = "";
    try { const d = await prisma.device.findFirst({ where: { deviceType: "NVR", ip }, select: { brand: true } }); nvrBrand = (d?.brand || "").toUpperCase(); } catch { }
    if (nvrBrand === "DAHUA") {
        let dErr = "";
        for (const cred of creds) {
            try { const ch = await getDahuaChannels(ip, cred.username, cred.password); if (ch.length) return { ok: true, authType: "DIGEST", channels: ch }; }
            catch (e: any) { dErr = e?.message || String(e); }
        }
        return { ok: false, error: dErr || "Sin respuesta CGI del NVR Dahua", channels: [] as any[] };
    }

    let lastErr = "";
    for (const cred of creds) {
        for (const a of ["DIGEST", "BASIC"]) {
            try {
                const dev: any = { ip, username: cred.username, password: cred.password, authType: a };
                const xml: string = await authenticatedRequest("GET", "/ISAPI/ContentMgmt/InputProxy/channels", dev, { responseType: "text", accept: "application/xml", contentType: "application/xml" });
                const channels = parseInputProxy(String(xml || ""));
                if (channels.length) return { ok: true, authType: a, channels };
            } catch (e: any) { lastErr = e?.message || String(e); }
        }
    }
    // Fallback: si ISAPI no respondió, probar CGI Dahua (NVR de marca no declarada).
    for (const cred of creds) {
        try { const ch = await getDahuaChannels(ip, cred.username, cred.password); if (ch.length) return { ok: true, authType: "DIGEST", channels: ch }; } catch { }
    }
    return { ok: false, error: lastErr || "Sin respuesta del NVR (ISAPI/CGI)", channels: [] as any[] };
}

// ── Canales de un NVR Dahua por CGI: RemoteDevice (cámaras remotas) + ChannelTitle (nombres) ──
async function getDahuaChannels(ip: string, username: string, password: string): Promise<{ channel: number; ip: string | null; name: string | null; brand?: string }[]> {
    const dev: any = { ip, username, password, authType: "DIGEST", brand: "DAHUA" };
    const titles: Record<number, string> = {};
    try {
        const ct: string = await authenticatedRequest("GET", "/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle", dev, { responseType: "text", timeout: 8000 });
        const rx = /ChannelTitle\[(\d+)\]\.Name=([^\r\n]*)/g; let mm: RegExpExecArray | null;
        while ((mm = rx.exec(String(ct || "")))) { const t = mm[2].trim(); if (t) titles[parseInt(mm[1])] = t; }
    } catch { }
    const rd: string = await authenticatedRequest("GET", "/cgi-bin/configManager.cgi?action=getConfig&name=RemoteDevice", dev, { responseType: "text", timeout: 8000 });
    return parseDahuaRemote(String(rd || ""), titles);
}

function parseDahuaRemote(text: string, titles: Record<number, string>): { channel: number; ip: string | null; name: string | null; brand?: string }[] {
    // Soporta las dos formas de clave: table.RemoteDevice[N].X y table.RemoteDevice.uuid:..._N.X
    const byIdx: Record<number, { ip: string | null; name: string | null; enable: boolean; vendor: string | null; devType: string | null }> = {};
    const re = /RemoteDevice(?:\[(\d+)\]|\.uuid:[^.=]*?_(\d+))\.([A-Za-z0-9_]+)=([^\r\n]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
        const idx = parseInt(m[1] ?? m[2]); if (isNaN(idx)) continue;
        const key = m[3]; const val = (m[4] || "").trim();
        const e = byIdx[idx] || (byIdx[idx] = { ip: null, name: null, enable: false, vendor: null, devType: null });
        if (key === "Address") e.ip = val || null;
        else if (key === "Enable") e.enable = /true/i.test(val);
        else if (key === "Name" && !e.name) e.name = val || null;
        else if (key === "Vendor") e.vendor = val || null;
        else if (key === "DeviceType") e.devType = val || null;
    }
    const out: { channel: number; ip: string | null; name: string | null; brand?: string }[] = [];
    for (const k of Object.keys(byIdx).map(Number).sort((a, b) => a - b)) {
        const e = byIdx[k]; if (!e.ip || e.ip === "192.168.0.0" || e.ip === "0.0.0.0") continue;
        const brand = /dahua|dh-|ipc-|tpc-/i.test((e.vendor || "") + "|" + (e.devType || "")) ? "DAHUA" : "HIKVISION";
        out.push({ channel: k + 1, ip: e.ip, name: titles[k] || e.name || ("Canal " + (k + 1)), brand });
    }
    return out;
}

function parseInputProxy(xml: string): { channel: number; ip: string | null; name: string | null }[] {
    const out: { channel: number; ip: string | null; name: string | null }[] = [];
    const blocks = xml.split(/<InputProxyChannel[\s>]/i).slice(1);
    for (const b of blocks) {
        const idM = b.match(/<id>\s*(\d+)\s*<\/id>/i);
        const ipM = b.match(/<ipAddress>\s*([0-9.]+)\s*<\/ipAddress>/i);
        const nmM = b.match(/<name>\s*([^<]*)\s*<\/name>/i);
        if (idM) out.push({ channel: parseInt(idM[1]), ip: ipM ? ipM[1] : null, name: nmM ? nmM[1].trim() : null });
    }
    return out;
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
