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
                if (channels.length) return { ok: true, authType: a, channels };
            } catch (e: any) { lastErr = e?.message || String(e); }
        }
    }
    return { ok: false, error: lastErr || "Sin respuesta ISAPI del NVR", channels: [] as any[] };
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
