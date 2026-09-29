import { prisma } from "@/lib/prisma";

/**
 * Resolución de NVR para soporte multi-NVR.
 *
 * Modelo: cada NVR es un Device (deviceType = NVR) con su propia ip/username/password/port(RTSP).
 * El mapa de canales (Setting NVR_CHANNEL_MAP) asocia cada cámara (por IP) a { nvr: <nvrDeviceId>, ch: <canal> }.
 *
 * Compatibilidad: si el mapa está en el formato viejo { ip: canal }, se asume el NVR por defecto
 * (el Device NVR cuyo ip == NVR_HOST, o el primer NVR). Si no hay ningún Device NVR, se cae a los
 * settings globales NVR_HOST/USER/PASS/PORT (instalaciones de un solo NVR previas).
 */

export type NvrConn = { nvrId: string | null; ip: string; user: string; pass: string; rtspPort: string };

async function legacyDefault(): Promise<NvrConn | null> {
    const rows = await prisma.setting.findMany({ where: { key: { in: ["NVR_HOST", "NVR_USER", "NVR_PASS", "NVR_PORT"] } } });
    const cfg: any = {}; rows.forEach((r: any) => (cfg[r.key] = r.value));
    if (!cfg.NVR_HOST) return null;
    return { nvrId: null, ip: cfg.NVR_HOST, user: cfg.NVR_USER || "admin", pass: cfg.NVR_PASS || "", rtspPort: cfg.NVR_PORT || "554" };
}

/** Devuelve el id del NVR por defecto (para normalizar mapas viejos). */
export async function defaultNvrId(): Promise<string | null> {
    const host = (await prisma.setting.findUnique({ where: { key: "NVR_HOST" } }))?.value;
    if (host) {
        const d = await prisma.device.findFirst({ where: { deviceType: "NVR", ip: host }, select: { id: true } });
        if (d) return d.id;
    }
    const any = await prisma.device.findFirst({ where: { deviceType: "NVR" }, select: { id: true }, orderBy: { createdAt: "asc" } });
    return any?.id ?? null;
}

/** Conexión de un NVR por su id (con fallback a settings globales). */
export async function resolveNvrById(nvrId?: string | null): Promise<NvrConn | null> {
    if (nvrId) {
        const d = await prisma.device.findUnique({ where: { id: nvrId }, select: { ip: true, username: true, password: true, port: true } });
        if (d?.ip) return { nvrId, ip: d.ip, user: d.username || "admin", pass: d.password || "", rtspPort: d.port ? String(d.port) : "554" };
    }
    return legacyDefault();
}

/** Mapa de canales normalizado: { ipCámara: { nvrId, ch } }. */
export async function getChannelMap(): Promise<Record<string, { nvrId: string | null; ch: number }>> {
    const out: Record<string, { nvrId: string | null; ch: number }> = {};
    const row = await prisma.setting.findUnique({ where: { key: "NVR_CHANNEL_MAP" } });
    if (!row?.value) return out;
    let def: string | null | undefined = undefined;
    try {
        const m = JSON.parse(row.value);
        for (const k of Object.keys(m)) {
            const v: any = m[k];
            if (v && typeof v === "object") {
                out[k] = { nvrId: v.nvr ?? v.nvrId ?? null, ch: Number(v.ch) };
            } else {
                if (def === undefined) def = await defaultNvrId();
                out[k] = { nvrId: def ?? null, ch: Number(v) };
            }
        }
    } catch { /* ignore */ }
    return out;
}

/** Resuelve NVR + canal para una cámara (por su deviceId). */
export async function resolveForCamera(cameraId?: string | null): Promise<{ nvr: NvrConn; ch: number } | null> {
    if (!cameraId) return null;
    const dev = await prisma.device.findUnique({ where: { id: cameraId }, select: { ip: true } });
    if (!dev?.ip) return null;
    const map = await getChannelMap();
    const entry = map[dev.ip];
    if (!entry || !entry.ch) return null;
    const nvr = await resolveNvrById(entry.nvrId);
    if (!nvr) return null;
    return { nvr, ch: entry.ch };
}
