import fs from "fs";
import net from "net";
import yaml from "js-yaml";
import { prisma } from "@/lib/prisma";
import { getChannelMap, resolveNvrById } from "@/lib/nvr-resolve";

/** ¿Responde el puerto RTSP de este host? (para decidir directo-a-cámara vs NVR). */
function tcpReachable(ip: string, port = 554, ms = 1500): Promise<boolean> {
    return new Promise((resolve) => {
        const s = new net.Socket();
        let done = false;
        const finish = (ok: boolean) => { if (done) return; done = true; try { s.destroy(); } catch { } resolve(ok); };
        s.setTimeout(ms);
        s.once("connect", () => finish(true));
        s.once("timeout", () => finish(false));
        s.once("error", () => finish(false));
        try { s.connect(port, ip); } catch { finish(false); }
    });
}

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
        doc.streams[name] = [sd, `ffmpeg:${name}#video=h264#hardware=vaapi`];
        doc.streams[nameHd] = [hd, `ffmpeg:${nameHd}#video=h264#hardware=vaapi`];
        try { fs.copyFileSync(CONFIG, `${CONFIG}.bak.auto.${Date.now()}`); } catch { }
        fs.writeFileSync(CONFIG, yaml.dump(doc, { lineWidth: 400 }), "utf8");
    } catch (e) { console.error("[go2rtc-sync] yaml:", (e as any)?.message); }
    // 2) En caliente por la API — registrar RTSP crudo + productor ffmpeg de transcode a H264
    //    (sin el transcode, los canales H265 devuelven 500 a stream.mp4?video=h264 y el navegador no reproduce)
    const put = async (n: string, ...srcs: string[]) => {
        try {
            const c = new AbortController(); const t = setTimeout(() => c.abort(), 5000);
            const qs = srcs.map((x) => `src=${enc(x)}`).join("&"); // go2rtc: un solo PUT fija TODAS las fuentes
            await fetch(`${GO2RTC}/api/streams?name=${enc(n)}&${qs}`, { method: "PUT", signal: c.signal });
            clearTimeout(t);
        } catch { }
    };
    await put(name, sd, `ffmpeg:${name}#video=h264#hardware=vaapi`);
    await put(nameHd, hd, `ffmpeg:${nameHd}#video=h264#hardware=vaapi`);
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
                        // VIVO SD: directo a la cámara si su RTSP responde (menos latencia + descarga al NVR);
                        //          si no responde (cámara aislada detrás del NVR), cae al NVR.
                        // VIVO HD: siempre por el NVR (el main es H265 y se transcodifica igual).
                        const direct = await tcpReachable(dev.ip, 554, 1500);
                        const sd = direct ? rtspDirect(dev, "102") : rtspViaNvr(nvr, entry.ch, false);
                        console.log(`[go2rtc-sync] ${dev.ip} SD=${direct ? "directo-cámara" : "vía-NVR"}`);
                        await writeStreams(name, nameHd, sd, rtspViaNvr(nvr, entry.ch, true));
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
