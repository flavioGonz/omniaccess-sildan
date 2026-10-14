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
async function getDahuaChannels(ip: string, username: string, password: string): Promise<CanalNvr[]> {
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

/**
 * Qué cámara hay realmente en cada canal.
 *
 * Un NVR no graba sólo cámaras de su marca: el Dahua del perímetro tiene Hikvision por ONVIF y
 * los Hikvision tienen Dahua por RTSP. La marca de la CÁMARA decide cómo se le habla directo
 * (ISAPI o CGI, la ruta RTSP); la del NVR decide cómo se piden sus grabaciones. Antes se
 * suponía «Hikvision salvo que diga Dahua» y las Hikvision del Dahua quedaban como Dahua.
 */
export type CanalNvr = {
    channel: number; ip: string | null; name: string | null; brand?: string; model?: string | null;
    protocolo?: string | null; serie?: string | null; mac?: string | null;
    /** El mismo equipo ya apareció en un canal anterior (cámara bi-espectral / multisensor). */
    sensorDe?: number | null;
};

function marcaPorModelo(modelo?: string | null, extra?: string | null): string | null {
    const m = `${modelo || ""} ${extra || ""}`.trim();
    if (!m) return null;
    if (/\b(i?ds-|hikvision|hik\b)/i.test(m)) return "HIKVISION";
    if (/\b(dh-|dhi-|ipc-hf|ipc-hdw|ipc-hdbw|ipc-hfw|tpc-|sd\d|ptz\d|dahua)/i.test(m)) return "DAHUA";
    if (/\b(vip|vhd|vhc|intelbras)/i.test(m)) return "INTELBRAS";
    if (/\b(ipc\d{3,}|uniview|unv)/i.test(m)) return "UNIVIEW";
    if (/\b(axis|[pmq]\d{4})/i.test(m)) return "AXIS";
    if (/\b(bosch|nbe-|nde-|flexidome|dinion|autodome)/i.test(m)) return "BOSCH";
    if (/milesight|\bms-c/i.test(m)) return "MILESIGHT";
    return null;
}

function parseDahuaRemote(text: string, titles: Record<number, string>): CanalNvr[] {
    // Dos formas de clave: table.RemoteDevice[N].X y table.RemoteDevice.uuid:..._N.X
    type E = { ip: string | null; name: string | null; enable: boolean; vendor: string | null; devType: string | null; proto: string | null; serie: string | null; mac: string | null; vin: string | null };
    const byIdx: Record<number, E> = {};
    const re = /RemoteDevice(?:\[(\d+)\]|\.uuid:[^.=]*?_(\d+))\.([A-Za-z0-9_\[\]\.]+)=([^\r\n]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
        const idx = parseInt(m[1] ?? m[2]); if (isNaN(idx)) continue;
        const key = m[3]; const val = (m[4] || "").trim();
        const e = byIdx[idx] || (byIdx[idx] = { ip: null, name: null, enable: false, vendor: null, devType: null, proto: null, serie: null, mac: null, vin: null });
        if (key === "Address") e.ip = val || null;
        else if (key === "Enable") e.enable = /true/i.test(val);
        else if (key === "Name") e.name = val || null;
        else if (key === "Vendor") e.vendor = val || null;
        else if (key === "DeviceType") e.devType = val || null;
        else if (key === "ProtocolType") e.proto = val || null;
        else if (key === "SerialNo") e.serie = val || null;
        else if (key === "Mac") e.mac = val || null;
        else if (key === "VideoInputs[0].Name") e.vin = val || null;
    }
    const out: CanalNvr[] = [];
    const primero: Record<string, number> = {};
    for (const k of Object.keys(byIdx).map(Number).sort((a, b) => a - b)) {
        const e = byIdx[k]; if (!e.ip || e.ip === "192.168.0.0" || e.ip === "0.0.0.0" || !e.enable) continue;
        // «Private» = protocolo propietario Dahua: la cámara es Dahua (o una OEM Dahua).
        const brand = marcaPorModelo(e.devType, e.serie) || (/private|dahua/i.test(`${e.proto} ${e.vendor}`) ? "DAHUA" : null) || "OTRA";
        const protocolo = /private/i.test(e.proto || "") ? "Dahua (privado)" : e.proto || e.vendor || null;
        const ch = k + 1;
        const sensorDe = primero[e.ip] ?? null;
        if (sensorDe == null) primero[e.ip] = ch;
        out.push({ channel: ch, ip: e.ip, name: titles[k] || e.vin || e.name || ("Canal " + ch), brand, model: e.devType, protocolo, serie: e.serie, mac: e.mac, sensorDe });
    }
    return out;
}

function parseInputProxy(xml: string): CanalNvr[] {
    const out: CanalNvr[] = [];
    const primero: Record<string, number> = {};
    const blocks = xml.split(/<InputProxyChannel[\s>]/i).slice(1);
    for (const b of blocks) {
        const tag = (t: string) => { const r = b.match(new RegExp(`<${t}>\\s*([^<]*?)\\s*</${t}>`, "i")); return r ? r[1] : null; };
        const idM = b.match(/<id>\s*(\d+)\s*<\/id>/i);
        if (!idM) continue;
        const ip = (b.match(/<ipAddress>\s*([0-9.]+)\s*<\/ipAddress>/i) || [])[1] || null;
        const proto = tag("proxyProtocol");
        const model = tag("model") || null;
        // proxyProtocol: HIKVISION (SDK propio), DAHUA_RTSP, ONVIF, AXIS, CUSTOM…
        const brand = /^hikvision$/i.test(proto || "") ? "HIKVISION" : /dahua/i.test(proto || "") ? "DAHUA" : marcaPorModelo(model, proto) || (proto ? "OTRA" : "HIKVISION");
        const ch = parseInt(idM[1]);
        const sensorDe = ip ? (primero[ip] ?? null) : null;
        if (ip && sensorDe == null) primero[ip] = ch;
        out.push({ channel: ch, ip, name: tag("name"), brand, model, protocolo: proto, serie: tag("serialNumber"), sensorDe });
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

/* ───────────────── Importar canales del NVR clasificando cada cámara (Olivos) ─────────────────
 * Antes la importación creaba todo como cámara común. Ahora cada canal se clasifica antes de
 * crearlo: LPR (de entrada o de salida) o intrusión; lo que ya existe con esa IP sólo se mapea. */
export type RolImport = "lpr" | "intrusion" | "omitir";
export type CanalParaImportar = { channel: number; ip: string | null; name: string; model?: string | null; marca: string; protocolo?: string | null; sensorDe?: number | null; existente: { id: string; name: string; tipo: string; marca: string } | null; sugerido: { rol: RolImport; direction: "ENTRY" | "EXIT"; por: string } };

const ES_LPR = /\b(lpr|anpr)\b|matr[ií]cula|patente|entrada|salida|acceso|barrera/i;
export async function canalesParaImportar(nvrDeviceId: string): Promise<{ ok: boolean; error?: string; canales: CanalParaImportar[] }> {
    const { getSession } = await import("@/app/actions/auth");
    if (!(await getSession())) return { ok: false, error: "Hace falta una sesión del panel.", canales: [] };
    const nvr = await prisma.device.findUnique({ where: { id: nvrDeviceId } });
    if (!nvr || String(nvr.deviceType) !== "NVR") return { ok: false, error: "El NVR no existe", canales: [] };
    const r: any = await getNvrChannels({ ip: nvr.ip, username: nvr.username || undefined, password: nvr.password || undefined, authType: (nvr.authType as any) || undefined });
    if (!r?.ok) return { ok: false, error: r?.error || "No se pudieron leer los canales del NVR", canales: [] };
    const ips = (r.channels || []).map((c: any) => c.ip).filter(Boolean);
    const existentes = await prisma.device.findMany({ where: { ip: { in: ips } }, select: { id: true, name: true, ip: true, deviceType: true, brand: true } });
    const porIp = new Map(existentes.map((e) => [e.ip, e]));
    return {
        ok: true,
        canales: (r.channels || []).map((c: any) => {
            const name = (c.name && String(c.name).trim()) || `${nvr.name} · ch ${c.channel}`;
            const e = c.ip ? porIp.get(c.ip) : null;
            const lpr = ES_LPR.test(`${name} ${c.model || ""}`);
            return {
                channel: c.channel, ip: c.ip || null, name, model: c.model || null, marca: c.brand || String(nvr.brand), protocolo: c.protocolo || null, sensorDe: c.sensorDe ?? null,
                existente: e ? { id: e.id, name: e.name, tipo: String(e.deviceType), marca: String(e.brand) } : null,
                sugerido: { rol: lpr ? "lpr" : "intrusion", direction: /salida|exit/i.test(name) ? "EXIT" : "ENTRY", por: lpr ? "el nombre habla de matrículas / accesos" : "cámara del perímetro" },
            } as CanalParaImportar;
        }),
    };
}

export async function importarCanalesClasificados(nvrDeviceId: string, pedidos: { channel: number; rol: RolImport; direction?: "ENTRY" | "EXIT"; groupId?: string | null }[]): Promise<{ ok: boolean; error?: string; creadas: number; mapeadas: number; detalle: { channel: number; name: string; accion: string; motivo?: string }[] }> {
    const { getSession } = await import("@/app/actions/auth");
    if (!(await getSession())) return { ok: false, error: "Hace falta una sesión del panel.", creadas: 0, mapeadas: 0, detalle: [] };
    const detalle: { channel: number; name: string; accion: string; motivo?: string }[] = [];
    const nvr = await prisma.device.findUnique({ where: { id: nvrDeviceId } });
    if (!nvr || String(nvr.deviceType) !== "NVR") return { ok: false, error: "El NVR no existe", creadas: 0, mapeadas: 0, detalle };
    const r: any = await getNvrChannels({ ip: nvr.ip, username: nvr.username || undefined, password: nvr.password || undefined, authType: (nvr.authType as any) || undefined });
    if (!r?.ok) return { ok: false, error: r?.error || "No se pudieron leer los canales", creadas: 0, mapeadas: 0, detalle };
    const porCanal = new Map((r.channels || []).map((c: any) => [Number(c.channel), c]));
    const mapa = await getChannelMap();
    const nuevo: Record<string, { nvr: string | null; ch: number }> = {};
    for (const k of Object.keys(mapa)) nuevo[k] = { nvr: mapa[k].nvrId, ch: mapa[k].ch };
    let creadas = 0, mapeadas = 0;
    // Las cámaras que quedan grabando en este NVR: a todas se les calcula la retención al final.
    const paraRetencion: string[] = [];
    for (const p of pedidos) {
        const c: any = porCanal.get(Number(p.channel));
        if (!c) { detalle.push({ channel: p.channel, name: `Canal ${p.channel}`, accion: "omitida", motivo: "el NVR ya no tiene ese canal" }); continue; }
        const name = (c.name && String(c.name).trim()) || `${nvr.name} · ch ${c.channel}`;
        if (p.rol === "omitir") continue;
        if (!c.ip) { detalle.push({ channel: c.channel, name, accion: "omitida", motivo: "el canal no tiene IP" }); continue; }
        const existente = await prisma.device.findFirst({ where: { ip: c.ip } });
        nuevo[c.ip] = { nvr: nvr.id, ch: Number(c.channel) };
        paraRetencion.push(c.ip);
        const marca = (c.brand && c.brand !== "OTRA" ? c.brand : null) as any;
        if (existente) {
            // Si la marca guardada no es la de la cámara (p.ej. una Hikvision por ONVIF cargada como Dahua), se corrige.
            if (marca && String(existente.brand) !== marca) { await prisma.device.update({ where: { id: existente.id }, data: { brand: marca } }); try { const { syncLprStream } = await import("@/lib/go2rtc-sync"); await syncLprStream({ ...existente, brand: marca } as any); } catch { } }
            mapeadas++; detalle.push({ channel: c.channel, name: existente.name, accion: "mapeada", motivo: "ya existía: sólo se vinculó la grabación" + (marca && String(existente.brand) !== marca ? ` (marca corregida a ${marca})` : "") }); continue;
        }
        if (c.sensorDe) { detalle.push({ channel: c.channel, name, accion: "omitida", motivo: `es otro sensor de la cámara del canal ${c.sensorDe} (misma IP)` }); continue; }
        const lpr = p.rol === "lpr";
        const dev = await prisma.device.create({
            data: {
                name, ip: c.ip, brand: marca || nvr.brand, deviceType: (lpr ? "LPR_CAMERA" : "CAMERA") as any,
                username: nvr.username, password: nvr.password,
                authType: (nvr.brand === "HIKVISION" && lpr ? "DIGEST" : nvr.authType) as any,
                deviceModel: c.model || undefined,
                direction: (lpr ? (p.direction === "EXIT" ? "EXIT" : "ENTRY") : "ENTRY") as any,
                accessGroups: lpr && p.groupId && p.groupId !== "none" ? { connect: { id: p.groupId } } : undefined,
            },
        });
        creadas++;
        detalle.push({ channel: c.channel, name, accion: lpr ? "creada como LPR" : "creada como intrusión" });
        try { const { syncLprStream } = await import("@/lib/go2rtc-sync"); await syncLprStream(dev as any); } catch { }
        if (lpr && String(dev.brand) === "HIKVISION") { try { const { provisionLprDevice } = await import("@/app/actions/provision"); await provisionLprDevice(dev.id, false); } catch { } }
    }
    await prisma.setting.upsert({ where: { key: "NVR_CHANNEL_MAP" }, update: { value: JSON.stringify(nuevo) }, create: { key: "NVR_CHANNEL_MAP", value: JSON.stringify(nuevo) } });
    // La retención de cada una, sin esperar (Nico, 14/10: «para no tener que hacerlo sí o sí a
    // mano»). Va de a una — es una búsqueda de grabaciones en el NVR por canal — y en segundo
    // plano: con 30 canales serían minutos de espera para el que importa. Queda guardada y la
    // ficha y la lista la muestran; si alguna falla, la ficha la vuelve a intentar al abrirse.
    if (paraRetencion.length) void (async () => {
        const { calcularRetencion } = await import("@/lib/grabaciones");
        for (const ip of paraRetencion) await calcularRetencion(ip).catch(() => null);
    })();
    return { ok: true, creadas, mapeadas, detalle };
}
