"use server";

import { prisma } from "@/lib/prisma";

// Resuelve el canal del NVR para un dispositivo (cámara) según el mapa IP->canal en Settings.
export async function getNvrChannel(deviceId?: string | null): Promise<number | null> {
    if (!deviceId) return null;
    try {
        const dev = await prisma.device.findUnique({ where: { id: deviceId }, select: { ip: true } });
        if (!dev?.ip) return null;
        const row = await prisma.setting.findUnique({ where: { key: "NVR_CHANNEL_MAP" } });
        if (!row?.value) return null;
        const map = JSON.parse(row.value) as Record<string, number | string>;
        const ch = map[dev.ip];
        return ch != null ? Number(ch) : null;
    } catch {
        return null;
    }
}

import { authenticatedRequest } from "@/lib/digest-auth";

// Lee los canales configurados del NVR vía ISAPI (InputProxy) -> [{channel, ip, name}]
export async function getNvrChannels(input: { ip: string; username?: string; password?: string; authType?: string }) {
    // Credenciales candidatas: primero las del form; luego las del NVR guardadas en Settings (probadas OK).
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

export async function getNvrChannelMap(): Promise<Record<string, number>> {
    try {
        const row = await prisma.setting.findUnique({ where: { key: "NVR_CHANNEL_MAP" } });
        if (!row?.value) return {};
        const m = JSON.parse(row.value);
        const out: Record<string, number> = {};
        for (const k of Object.keys(m)) out[k] = Number(m[k]);
        return out;
    } catch { return {}; }
}

export async function saveNvrChannelMap(map: Record<string, number | string>): Promise<{ ok: boolean }> {
    try {
        const clean: Record<string, number> = {};
        for (const k of Object.keys(map || {})) {
            const n = Number(map[k]);
            if (k && !isNaN(n) && n > 0) clean[k] = n;
        }
        await prisma.setting.upsert({
            where: { key: "NVR_CHANNEL_MAP" },
            update: { value: JSON.stringify(clean) },
            create: { key: "NVR_CHANNEL_MAP", value: JSON.stringify(clean) },
        });
        return { ok: true };
    } catch { return { ok: false }; }
}
