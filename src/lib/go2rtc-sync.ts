import fs from "fs";
import yaml from "js-yaml";

const CONFIG = process.env.GO2RTC_CONFIG || "/opt/OmniAccess/go2rtc.yaml";
const GO2RTC = process.env.GO2RTC_API || "http://127.0.0.1:1984";

type Dev = {
    id: string;
    ip?: string | null;
    username?: string | null;
    password?: string | null;
    brand?: string | null;
    deviceType?: string | null;
    rtspUrl?: string | null;
};

function rtsp(dev: Dev, channel: string): string {
    const user = dev.username || "admin";
    const pass = dev.password || "";
    const cred = pass ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : `${encodeURIComponent(user)}@`;
    // Hikvision: Channels/102 = substream (SD), /101 = mainstream (HD)
    return `rtsp://${cred}${dev.ip}:554/Streaming/Channels/${channel}`;
}

/**
 * Registra (o actualiza) el stream go2rtc de una cámara LPR: escribe el
 * go2rtc.yaml (persistencia) y lo agrega en caliente por la API (sin restart).
 * Fire-and-forget: cualquier error se traga para no romper el alta del device.
 */
export async function syncLprStream(dev: Dev): Promise<void> {
    try {
        if (!dev) return;

        const interior = dev.deviceType === "LPR_INTERIOR";

        // Las cámaras interiores traen su URL RTSP escrita a mano (puede ser de
        // cualquier marca y con el canal que sea), así que se usa tal cual y no
        // se arma a partir de la IP.
        if (interior) {
            if (!dev.rtspUrl || !dev.rtspUrl.trim()) return;
        } else {
            if (dev.deviceType !== "LPR_CAMERA" || !dev.ip) return;
            // Sólo Hikvision (la flota Los Olivos). Otras marcas: dejar manual.
            if (dev.brand && dev.brand !== "HIKVISION") return;
        }

        const name = `lpr_${dev.id}`;
        const nameHd = `${name}_hd`;
        // En una cámara interior no hay subflujo conocido: el mismo origen sirve
        // para las dos entradas, así el visor en vivo encuentra el stream igual.
        const sd = interior ? dev.rtspUrl!.trim() : rtsp(dev, "102");
        const hd = interior ? dev.rtspUrl!.trim() : rtsp(dev, "101");

        // 1) Persistir en go2rtc.yaml
        try {
            let doc: any = {};
            if (fs.existsSync(CONFIG)) {
                doc = (yaml.load(fs.readFileSync(CONFIG, "utf8")) as any) || {};
            }
            if (!doc.streams || typeof doc.streams !== "object") doc.streams = {};
            doc.streams[name] = [sd, `ffmpeg:${name}#video=h264`];
            doc.streams[nameHd] = [hd, `ffmpeg:${nameHd}#video=h264`];
            // backup + write
            try { fs.copyFileSync(CONFIG, `${CONFIG}.bak.auto.${Date.now()}`); } catch { }
            fs.writeFileSync(CONFIG, yaml.dump(doc, { lineWidth: 200 }), "utf8");
        } catch (e) {
            console.error("[go2rtc-sync] yaml write failed:", (e as any)?.message);
        }

        // 2) Agregar en caliente por la API (efecto inmediato, sin restart)
        const put = async (n: string, src: string) => {
            try {
                const ctrl = new AbortController();
                const to = setTimeout(() => ctrl.abort(), 5000);
                await fetch(`${GO2RTC}/api/streams?name=${encodeURIComponent(n)}&src=${encodeURIComponent(src)}`, { method: "PUT", signal: ctrl.signal });
                clearTimeout(to);
            } catch { }
        };
        await put(name, sd);
        await put(nameHd, hd);
    } catch (e) {
        console.error("[go2rtc-sync] failed:", (e as any)?.message);
    }
}
