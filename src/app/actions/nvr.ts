"use server";

import { prisma } from "@/lib/prisma";
import { authenticatedRequest } from "@/lib/digest-auth";
import { getChannelMap } from "@/lib/nvr-resolve";
import { ROLES, type RolCamara } from "@/lib/rol-camara";

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
                if (channels.length) {
                    const estado = await leerEstadoCanales(dev);
                    for (const c of channels) if (c.channel in estado) c.online = estado[c.channel];
                    return { ok: true, authType: a, channels };
                }
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
    /** Si el grabador ve el canal conectado (lo usa San Nicolás al listar; null = no se sabe). */
    online?: boolean | null;
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

// El tag puede venir pelado (`<InputProxyChannel>`, fw V4.63) o con atributos
// (`<InputProxyChannel version="1.0" xmlns=...>`, fw V4.83 de los NXI): por eso se parte por
// `[\s>]` y no por el tag exacto. Verificado contra los dos NVR de San Nicolás.
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
// Lo que el primer barrio hizo a mano en la base (79 canales) acá es una acción. Cada canal elegido
// pasa a ser un Device tipo CAMERA con las credenciales del NVR, queda mapeado {nvr, ch} en
// NVR_CHANNEL_MAP (formato nuevo) y con su stream en go2rtc (rama CAMERA: HD vía NVR).
// Idempotente por IP: un canal ya importado se actualiza, no se duplica.
/**
 * Importar canales del grabador como cámaras, cada una con su ROL (ver lib/rol-camara).
 *
 * Dos errores de antes, que no se repiten:
 *  · Se creaban siempre como CAMERA: una cámara ANPR importada quedaba como cámara común.
 *    Ahora cada canal viene con el rol que se eligió; «acceso» exige sentido (entrada o salida),
 *    porque una LPR sin sentido no sabe si lo que lee entra o sale.
 *  · El mapa canal↔cámara de ESE grabador se REEMPLAZABA por los canales importados: el 10/10
 *    se perdieron los de LPR Entrada, LPR Salida y las tres perimetrales, y con eso el salto de
 *    un evento a su grabación. Ahora se AGREGA a lo que había.
 *
 * Si ya hay un equipo con esa IP no se crea otro ni se le cambia el tipo: se mapea y se avisa
 * (el tipo se cambia desde su ficha, con su confirmación).
 */
export type ImportCanal = { channel: number; rol: RolCamara; direction?: "ENTRY" | "EXIT"; groupId?: string | null };
export async function importarCanalesNvr(nvrDeviceId: string, pedidos: ImportCanal[]): Promise<{
    ok: boolean; error?: string; creadas: number; actualizadas: number;
    detalle: { channel: number; ip: string | null; name: string; accion: "creada" | "mapeada" | "omitida"; id?: string; rol?: RolCamara; tipoExistente?: string; motivo?: string }[];
}> {
    const detalle: { channel: number; ip: string | null; name: string; accion: "creada" | "mapeada" | "omitida"; id?: string; rol?: RolCamara; tipoExistente?: string; motivo?: string }[] = [];
    try {
        const nvr = await prisma.device.findUnique({ where: { id: nvrDeviceId } });
        if (!nvr || (nvr.deviceType as any) !== "NVR" || !nvr.ip) return { ok: false, error: "El NVR no existe o no tiene IP", creadas: 0, actualizadas: 0, detalle };
        if (!Array.isArray(pedidos) || !pedidos.length) return { ok: false, error: "No se eligió ningún canal.", creadas: 0, actualizadas: 0, detalle };

        const res = await getNvrChannels({ ip: nvr.ip, username: nvr.username || undefined, password: nvr.password || undefined, authType: (nvr.authType as any) || undefined });
        if (!res.ok) return { ok: false, error: res.error || "No se pudieron leer los canales", creadas: 0, actualizadas: 0, detalle };
        const porCanal = new Map((res.channels as CanalNvr[]).map((c) => [c.channel, c]));
        const mapa: Record<string, number> = {};
        let creadas = 0, actualizadas = 0;

        for (const p of pedidos) {
            const c = porCanal.get(Number(p.channel));
            const rol = ROLES[p.rol as RolCamara] ? (p.rol as RolCamara) : null;
            if (!c) { detalle.push({ channel: p.channel, ip: null, name: `Canal ${p.channel}`, accion: "omitida", motivo: "el grabador ya no tiene ese canal" }); continue; }
            const name = (c.name && c.name.trim()) || `${nvr.name} · ch ${c.channel}`;
            if (!c.ip) { detalle.push({ channel: c.channel, ip: null, name, accion: "omitida", motivo: "el canal no tiene IP" }); continue; }
            const existente = await prisma.device.findFirst({ where: { ip: c.ip } });
            if (existente) {
                mapa[c.ip] = c.channel;
                detalle.push({ channel: c.channel, ip: c.ip, name: existente.name, id: existente.id, accion: "mapeada", tipoExistente: String(existente.deviceType), motivo: "ya existía con esa IP: sólo se mapeó el canal" });
                actualizadas++;
                continue;
            }
            if (!rol) { detalle.push({ channel: c.channel, ip: c.ip, name, accion: "omitida", motivo: "falta elegir qué es la cámara" }); continue; }
            if (rol === "acceso" && p.direction !== "ENTRY" && p.direction !== "EXIT") { detalle.push({ channel: c.channel, ip: c.ip, name, accion: "omitida", motivo: "una LPR de acceso necesita el sentido (entrada o salida)" }); continue; }
            const tipo = ROLES[rol].tipo;
            const dev = await prisma.device.create({
                data: {
                    name, ip: c.ip, brand: nvr.brand, deviceType: tipo as any,
                    username: nvr.username, password: nvr.password,
                    // Hikvision LPR: DIGEST, como en el alta a mano (con Basic la foto da 502).
                    authType: (nvr.brand === "HIKVISION" && tipo === "LPR_CAMERA" ? "DIGEST" : nvr.authType) as any,
                    deviceModel: c.model || undefined,
                    direction: (rol === "acceso" ? p.direction : "ENTRY") as any,
                    // Sólo la de seguimiento le pide cuadros a la pasarela; el resto, no.
                    trackEnabled: rol === "seguimiento",
                    accessGroups: rol === "acceso" && p.groupId && p.groupId !== "none" ? { connect: { id: p.groupId } } : undefined,
                },
            });
            mapa[c.ip] = c.channel;
            detalle.push({ channel: c.channel, ip: c.ip, name: dev.name, id: dev.id, rol, accion: "creada" });
            creadas++;
            try { const { syncLprStream } = await import("@/lib/go2rtc-sync"); await syncLprStream(dev as any); } catch (e) { console.error("[importarCanalesNvr] go2rtc:", (e as any)?.message); }
            // Una LPR Hikvision se pone a punto igual que en el alta a mano (hora, servidor HTTP, ANPR, H264).
            if (rol === "acceso" && dev.brand === "HIKVISION") {
                try { const { provisionLprDevice } = await import("@/app/actions/provision"); await provisionLprDevice(dev.id, false); }
                catch (e) { console.error("[importarCanalesNvr] puesta a punto:", (e as any)?.message); }
            }
        }

        if (Object.keys(mapa).length) await agregarAlMapa(nvr.id, mapa);
        return { ok: true, creadas, actualizadas, detalle };
    } catch (e: any) {
        return { ok: false, error: e?.message || String(e), creadas: 0, actualizadas: 0, detalle };
    }
}

/** Agrega entradas al mapa canal↔cámara SIN tocar las demás (a diferencia de saveNvrChannelMapForNvr). */
async function agregarAlMapa(nvrId: string, entradas: Record<string, number>) {
    const fila = await prisma.setting.findUnique({ where: { key: "NVR_CHANNEL_MAP" } });
    let actual: Record<string, any> = {};
    try { actual = JSON.parse(fila?.value || "{}") || {}; } catch { actual = {}; }
    for (const [ip, ch] of Object.entries(entradas)) actual[ip] = { nvr: nvrId, ch };
    const value = JSON.stringify(actual);
    await prisma.setting.upsert({ where: { key: "NVR_CHANNEL_MAP" }, update: { value }, create: { key: "NVR_CHANNEL_MAP", value } });
}

/**
 * Completar el mapa por IP: cada canal del grabador cuya IP es la de una cámara nuestra queda
 * mapeado a ella. Es lo que se hizo a mano el 10/10 para recuperar el mapa perdido; queda como
 * botón para que no haga falta nadie que sepa.
 */
export async function mapearPorIp(nvrDeviceId: string): Promise<{ ok: boolean; error?: string; mapeados: { channel: number; ip: string; name: string }[] }> {
    try {
        const nvr = await prisma.device.findUnique({ where: { id: nvrDeviceId } });
        if (!nvr || (nvr.deviceType as any) !== "NVR" || !nvr.ip) return { ok: false, error: "El NVR no existe o no tiene IP", mapeados: [] };
        const res = await getNvrChannels({ ip: nvr.ip, username: nvr.username || undefined, password: nvr.password || undefined, authType: (nvr.authType as any) || undefined });
        if (!res.ok) return { ok: false, error: res.error || "No se pudieron leer los canales", mapeados: [] };
        const nuestras = await prisma.device.findMany({ where: { deviceType: { not: "NVR" } }, select: { ip: true, name: true } });
        const porIp = new Map(nuestras.map((d) => [d.ip, d.name]));
        const mapa: Record<string, number> = {};
        const mapeados: { channel: number; ip: string; name: string }[] = [];
        for (const c of res.channels as CanalNvr[]) if (c.ip && porIp.has(c.ip)) { mapa[c.ip] = c.channel; mapeados.push({ channel: c.channel, ip: c.ip, name: porIp.get(c.ip)! }); }
        if (mapeados.length) await agregarAlMapa(nvr.id, mapa);
        return { ok: true, mapeados };
    } catch (e: any) { return { ok: false, error: e?.message || String(e), mapeados: [] }; }
}

/* ───────────────── Importar canales del NVR clasificando cada cámara (Olivos) ─────────────────
 * Antes la importación creaba todo como cámara común. Ahora cada canal se clasifica antes de
 * crearlo: LPR (de entrada o de salida) o intrusión; lo que ya existe con esa IP sólo se mapea. */
export type RolImport = "lpr" | "intrusion" | "omitir";
export type CanalParaImportar = { channel: number; ip: string | null; name: string; model?: string | null; marca: string; protocolo?: string | null; sensorDe?: number | null; existente: { id: string; name: string; tipo: string; marca: string } | null;
    sugerido: { rol: RolImport; direction: "ENTRY" | "EXIT"; por: string; modoLpr?: import("@/lib/modo-camara").ModoLpr; modoIntr?: import("@/lib/modo-camara").ModoIntrusion };
    /** Lo que la cámara dijo que sabe hacer (lib/capacidades-camara), si se le pudo preguntar. */
    capacidades?: import("@/lib/capacidades-camara").Capacidades | null };

const ES_LPR = /\b(lpr|anpr)\b|matr[ií]cula|patente|entrada|salida|acceso|barrera/i;
export async function canalesParaImportar(nvrDeviceId: string): Promise<{ ok: boolean; error?: string; canales: CanalParaImportar[] }> {
    const { getSession } = await import("@/app/actions/auth");
    if (!(await getSession())) return { ok: false, error: "Hace falta una sesión del panel.", canales: [] };
    const nvr = await prisma.device.findUnique({ where: { id: nvrDeviceId } });
    if (!nvr || String(nvr.deviceType) !== "NVR") return { ok: false, error: "El NVR no existe", canales: [] };
    const r: any = await getNvrChannels({ ip: nvr.ip, username: nvr.username || undefined, password: nvr.password || undefined, authType: (nvr.authType as any) || undefined });
    if (!r?.ok) return { ok: false, error: r?.error || "No se pudieron leer los canales del NVR", canales: [] };
    const ips = (r.channels || []).map((c: any) => c.ip).filter(Boolean);
    const existentes = await prisma.device.findMany({ where: { ip: { in: ips } }, select: { id: true, name: true, ip: true, deviceType: true, brand: true, username: true, password: true, authType: true } });
    const porIp = new Map(existentes.map((e) => [e.ip, e]));
    // A cada cámara se le pregunta qué sabe hacer (16/10): el nombre del canal no alcanza —«MATRICULA
    // SALIDA» había quedado como intrusión—. La que ya existe, con su clave; la nueva, con la del NVR,
    // que es con la que se va a crear. Un sensor extra de la misma cámara no se pregunta dos veces.
    const { capacidadesDeVarias } = await import("@/lib/capacidades-camara");
    const aPreguntar = (r.channels || []).filter((c: any) => c.ip && !c.sensorDe).map((c: any) => {
        const e: any = porIp.get(c.ip);
        return { ip: c.ip, username: e?.username ?? nvr.username, password: e?.password ?? nvr.password, authType: e?.authType ? String(e.authType) : nvr.authType ? String(nvr.authType) : null, brand: c.brand && c.brand !== "OTRA" ? c.brand : e?.brand ? String(e.brand) : String(nvr.brand), deviceModel: c.model || null };
    });
    const caps = await capacidadesDeVarias(aPreguntar).catch(() => new Map());
    return {
        ok: true,
        canales: (r.channels || []).map((c: any) => {
            const name = (c.name && String(c.name).trim()) || `${nvr.name} · ch ${c.channel}`;
            const e = c.ip ? porIp.get(c.ip) : null;
            const cap = c.ip ? caps.get(c.ip) || null : null;
            // Lo que la cámara dice manda; el nombre del canal queda para cuando no se le pudo preguntar.
            const sabe = cap && cap.fuente !== "nada" && (cap.anpr !== null || cap.cruceLinea !== null);
            const porNombre = ES_LPR.test(`${name} ${c.model || ""}`);
            // Sin ANPR pero el nombre dice que mira un acceso: es una cámara para omni-LPR (como la .86).
            const omniLpr = !!sabe && cap!.anpr === false && porNombre;
            const lpr = sabe ? cap!.sugerido.tipo === "LPR_CAMERA" || omniLpr : porNombre;
            const por = omniLpr ? "el nombre dice acceso pero la cámara no tiene ANPR: la lee omni-lpr" : sabe ? `la cámara ${cap!.sugerido.por}` : lpr ? "el nombre habla de matrículas / accesos" : "cámara del perímetro";
            return {
                channel: c.channel, ip: c.ip || null, name, model: c.model || null, marca: c.brand || String(nvr.brand), protocolo: c.protocolo || null, sensorDe: c.sensorDe ?? null,
                existente: e ? { id: e.id, name: e.name, tipo: String(e.deviceType), marca: String(e.brand) } : null,
                sugerido: { rol: lpr ? "lpr" : "intrusion", direction: /salida|exit/i.test(name) ? "EXIT" : "ENTRY", por, modoLpr: omniLpr ? "omnivision" : sabe ? cap!.sugerido.modoLpr : "camara", modoIntr: sabe ? cap!.sugerido.modoIntr : "doble" },
                capacidades: cap,
            } as CanalParaImportar;
        }),
    };
}

export async function importarCanalesClasificados(nvrDeviceId: string, pedidos: { channel: number; rol: RolImport; direction?: "ENTRY" | "EXIT"; groupId?: string | null; modo?: string | null }[]): Promise<{ ok: boolean; error?: string; creadas: number; mapeadas: number; detalle: { channel: number; name: string; accion: string; motivo?: string }[] }> {
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
        try { const { syncLprStream } = await import("@/lib/go2rtc-sync"); await syncLprStream(dev as any); } catch { }
        // El modo elegido en la fila (lib/modo-camara.ts). La lectura de OmniVision no lleva la
        // puesta a punto de ANPR: la cámara no lee, sólo da el video.
        const { esModoLpr, esModoIntrusion, MODOS_LPR, MODOS_INTRUSION } = await import("@/lib/modo-camara");
        const { aplicarModoCamara } = await import("@/lib/modo-camara-db");
        const modoLpr = lpr && esModoLpr(p.modo) ? p.modo : null;
        const modoIntr = !lpr && esModoIntrusion(p.modo) ? p.modo : null;
        let pendientes: string[] = [];
        if (modoLpr && modoLpr !== "camara") pendientes = (await aplicarModoCamara(dev.id, { lpr: { modo: modoLpr } }).catch(() => ({ pendientes: ["no se pudo aplicar el modo"] }))).pendientes;
        if (modoIntr) pendientes = (await aplicarModoCamara(dev.id, { intrusion: modoIntr }).catch(() => ({ pendientes: ["no se pudo aplicar el modo"] }))).pendientes;
        const rotulo = modoLpr ? MODOS_LPR[modoLpr].rotulo : modoIntr ? MODOS_INTRUSION[modoIntr].rotulo : null;
        detalle.push({ channel: c.channel, name, accion: `${lpr ? "creada como LPR" : "creada como intrusión"}${rotulo ? ` · ${rotulo}` : ""}`, ...(pendientes.length ? { motivo: pendientes.join(" · ") } : {}) });
        if (lpr && modoLpr !== "omnivision" && String(dev.brand) === "HIKVISION") { try { const { provisionLprDevice } = await import("@/app/actions/provision"); await provisionLprDevice(dev.id, false); } catch { } }
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
