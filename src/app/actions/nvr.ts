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
