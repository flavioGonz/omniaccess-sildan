import fs from "fs";
import yaml from "js-yaml";
import { prisma } from "@/lib/prisma";
import { getChannelMap, resolveNvrById } from "@/lib/nvr-resolve";

const CONFIG = process.env.GO2RTC_CONFIG || "/opt/OmniAccess/go2rtc.yaml";
const GO2RTC = process.env.GO2RTC_API || "http://127.0.0.1:1984";

type Dev = {
    id: string;
    ip?: string | null;
    username?: string | null;
    password?: string | null;
    brand?: string | null;
    deviceType?: string | null;
};

const enc = encodeURIComponent;

/** RTSP directo a una cámara (LPR), por marca. */
function rtspDirect(dev: Dev, channel: string): string {
    const user = dev.username || "admin";
    const pass = dev.password || "";
    const cred = pass ? `${enc(user)}:${enc(pass)}@` : `${enc(user)}@`;
    if (String(dev.brand || "").toUpperCase() === "DAHUA") {
        return `rtsp://${cred}${dev.ip}:554/cam/realmonitor?channel=1&subtype=${channel === "102" ? 1 : 0}`;
    }
    return `rtsp://${cred}${dev.ip}:554/Streaming/Channels/${channel}`;
}

/** RTSP de un canal a través de la NVR (para cámaras colgadas de un NVR). */
function rtspViaNvr(nvr: { ip: string; user: string; pass: string; rtspPort: string; brand: string }, ch: number, hd: boolean): string {
    const cred = nvr.pass ? `${enc(nvr.user)}:${enc(nvr.pass)}@` : `${enc(nvr.user)}@`;
    const port = nvr.rtspPort || "554";
    if (String(nvr.brand).toUpperCase() === "DAHUA") {
        return `rtsp://${cred}${nvr.ip}:${port}/cam/realmonitor?channel=${ch}&subtype=${hd ? 0 : 1}`;
    }
    return `rtsp://${cred}${nvr.ip}:${port}/Streaming/Channels/${ch}${hd ? "01" : "02"}`;
}

async function writeStreams(name: string, nameHd: string, sd: string, hd: string): Promise<void> {
    // 1) Persistir en go2rtc.yaml
    try {
        let doc: any = {};
        if (fs.existsSync(CONFIG)) doc = (yaml.load(fs.readFileSync(CONFIG, "utf8")) as any) || {};
        if (!doc.streams || typeof doc.streams !== "object") doc.streams = {};
        doc.streams[name] = [sd, `ffmpeg:${name}#video=h264`];
        doc.streams[nameHd] = [hd, `ffmpeg:${nameHd}#video=h264`];
        try { fs.copyFileSync(CONFIG, `${CONFIG}.bak.auto.${Date.now()}`); } catch { }
        fs.writeFileSync(CONFIG, yaml.dump(doc, { lineWidth: 400 }), "utf8");
    } catch (e) { console.error("[go2rtc-sync] yaml:", (e as any)?.message); }
    // 2) En caliente por la API
    const put = async (n: string, src: string) => {
        try {
            const c = new AbortController(); const t = setTimeout(() => c.abort(), 5000);
            await fetch(`${GO2RTC}/api/streams?name=${enc(n)}&src=${enc(src)}`, { method: "PUT", signal: c.signal });
            clearTimeout(t);
        } catch { }
    };
    await put(name, sd); await put(nameHd, hd);
}

/**
 * Registra (o actualiza) el stream go2rtc de una cámara. Cubre:
 *  - LPR_CAMERA Hikvision: RTSP directo a la cámara (como siempre).
 *  - CAMERA (colgada de un NVR): RTSP a través de la NVR + canal (marca de la NVR),
 *    robusto aunque la cámara física sea de otra marca.
 * Nombre del stream: lpr_<id> (SD) y lpr_<id>_hd (HD) — compatible con el visor.
 */
export async function syncLprStream(dev: Dev): Promise<void> {
    try {
        if (!dev || !dev.ip) return;
        const name = `lpr_${dev.id}`;
        const nameHd = `${name}_hd`;

        if (dev.deviceType === "CAMERA") {
            // resolver NVR + canal por el mapa
            try {
                const map = await getChannelMap();
                const entry = map[dev.ip];
                if (entry && entry.ch) {
                    const nvr = await resolveNvrById(entry.nvrId);
                    if (nvr) {
                        await writeStreams(name, nameHd, rtspViaNvr(nvr, entry.ch, false), rtspViaNvr(nvr, entry.ch, true));
                        return;
                    }
                }
            } catch { }
            // sin mapeo: intentar directo por marca
            await writeStreams(name, nameHd, rtspDirect(dev, "102"), rtspDirect(dev, "101"));
            return;
        }

        // LPR: sólo Hikvision (flota Los Olivos); otras marcas quedan manuales.
        if (dev.deviceType !== "LPR_CAMERA") return;
        if (dev.brand && dev.brand !== "HIKVISION") return;
        await writeStreams(name, nameHd, rtspDirect(dev, "102"), rtspDirect(dev, "101"));
    } catch (e) {
        console.error("[go2rtc-sync] failed:", (e as any)?.message);
    }
}
