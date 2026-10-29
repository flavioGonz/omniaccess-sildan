/**
 * Telegram Bot Service for OmniAccess Queue Alerts
 * Sends queue occupancy alerts with snapshot photos to a Telegram group
 */

import https from "https";
import { fecha } from "@/lib/fechas";
import { prisma } from "@/lib/prisma";

/**
 * El bot y el grupo salen del .env o de Ajustes › Notificaciones (las mismas claves que guarda
 * CentroNotificaciones). Si no hay ninguno, NO se manda nada.
 *
 * Antes había un token y un chat escritos acá como respaldo: un bot real publicado en el repo, y
 * cualquier instalación sin configurar (el lab, una nueva) le mandaba sus alertas a ese grupo.
 * En San Nicolás, además, ya no servía: desde el 7/10 Telegram contesta «bot was kicked from
 * the group chat». Sin configuración, lo correcto es callarse y decirlo una vez en el log.
 */
let avisado = false;
async function configTelegram(): Promise<{ api: string; chat: string } | null> {
    let token = process.env.TELEGRAM_BOT_TOKEN || "", chat = process.env.TELEGRAM_CHAT_ID || "";
    if (!token || !chat) {
        const filas = await prisma.setting.findMany({ where: { key: { in: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] } } }).catch(() => []);
        const v = Object.fromEntries(filas.map((f) => [f.key, (f.value || "").trim()]));
        token ||= v.TELEGRAM_BOT_TOKEN || ""; chat ||= v.TELEGRAM_CHAT_ID || "";
    }
    if (!token || !chat) {
        if (!avisado) { avisado = true; console.warn("[Telegram] sin bot o grupo configurado: no se manda nada (Ajustes › Notificaciones)."); }
        return null;
    }
    return { api: `https://api.telegram.org/bot${token}`, chat };
}

// ─── Send Text Message ─────────────────────────────
export async function sendTelegramMessage(text: string): Promise<boolean> {
    try {
        const cfg = await configTelegram();
        if (!cfg) return false;
        const url = `${cfg.api}/sendMessage`;
        const body = JSON.stringify({
            chat_id: cfg.chat,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
        });

        return new Promise((resolve) => {
            const req = https.request(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                timeout: 10000,
            }, (res) => {
                let data = "";
                res.on("data", (chunk: Buffer) => data += chunk);
                res.on("end", () => {
                    if (res.statusCode === 200) {
                        resolve(true);
                    } else {
                        console.error(`[Telegram] Error ${res.statusCode}: ${data}`);
                        resolve(false);
                    }
                });
            });

            req.on("error", (err) => {
                console.error(`[Telegram] Request error: ${err.message}`);
                resolve(false);
            });

            req.on("timeout", () => {
                req.destroy();
                console.error("[Telegram] Request timeout");
                resolve(false);
            });

            req.write(body);
            req.end();
        });
    } catch (err: any) {
        console.error(`[Telegram] sendMessage error: ${err.message}`);
        return false;
    }
}

// ─── Send Photo with Caption ───────────────────────
export async function sendTelegramPhoto(
    photoUrl: string,
    caption: string,
    deviceIp: string,
    username: string,
    password: string
): Promise<boolean> {
    try {
        const cfg = await configTelegram();
        if (!cfg) return false;
        // First, fetch the snapshot from the camera
        const imageBuffer = await fetchCameraSnapshot(deviceIp, username, password);

        if (!imageBuffer) {
            // Fallback: send text-only message
            console.warn("[Telegram] No snapshot available, sending text only");
            return sendTelegramMessage(caption);
        }

        return postFoto(cfg, imageBuffer, caption);
    } catch (err: any) {
        console.error(`[Telegram] sendPhoto error: ${err.message}`);
        return false;
    }
}

/**
 * Una foto ya armada (no la de una cámara): el diagnóstico de imagen manda la comparación entre el
 * encuadre habitual y el de ahora. Si la foto no sale, va el texto solo.
 */
export async function enviarFotoTelegram(jpeg: Buffer, caption: string): Promise<boolean> {
    try {
        const cfg = await configTelegram();
        if (!cfg) return false;
        return await postFoto(cfg, jpeg, caption);
    } catch (err: any) {
        console.error(`[Telegram] enviarFoto error: ${err.message}`);
        return false;
    }
}

async function postFoto(cfg: { api: string; chat: string }, imageBuffer: Buffer, caption: string): Promise<boolean> {
        // Build multipart form data
        const boundary = "----TelegramBotBoundary" + Date.now();
        const parts: Buffer[] = [];

        // chat_id
        parts.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${cfg.chat}\r\n`
        ));

        // caption
        parts.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`
        ));

        // parse_mode
        parts.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML\r\n`
        ));

        // photo file
        parts.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="snapshot.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
        ));
        parts.push(imageBuffer);
        parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

        const body = Buffer.concat(parts);

        return new Promise((resolve) => {
            const url = new URL(`${cfg.api}/sendPhoto`);
            const req = https.request({
                hostname: url.hostname,
                path: url.pathname,
                method: "POST",
                headers: {
                    "Content-Type": `multipart/form-data; boundary=${boundary}`,
                    "Content-Length": body.length,
                },
                timeout: 15000,
            }, (res) => {
                let data = "";
                res.on("data", (chunk: Buffer) => data += chunk);
                res.on("end", () => {
                    if (res.statusCode === 200) {
                        console.log("[Telegram] Photo sent successfully");
                        resolve(true);
                    } else {
                        console.error(`[Telegram] sendPhoto error ${res.statusCode}: ${data}`);
                        // Fallback to text
                        sendTelegramMessage(caption).then(resolve);
                    }
                });
            });

            req.on("error", (err) => {
                console.error(`[Telegram] sendPhoto request error: ${err.message}`);
                resolve(false);
            });

            req.on("timeout", () => {
                req.destroy();
                console.error("[Telegram] sendPhoto timeout");
                resolve(false);
            });

            req.write(body);
            req.end();
        });
}

// ─── Fetch Camera Snapshot ─────────────────────────
function fetchCameraSnapshot(ip: string, username: string, password: string): Promise<Buffer | null> {
    return new Promise((resolve) => {
        const auth = Buffer.from(`${username}:${password}`).toString("base64");
        const snapshotUrl = `https://${ip}/snap.jpg?JpegSize=L`;
        const parsed = new URL(snapshotUrl);

        const req = https.request({
            hostname: parsed.hostname,
            port: 443,
            path: parsed.pathname + parsed.search,
            method: "GET",
            headers: { Authorization: `Basic ${auth}` },
            rejectUnauthorized: false,
            timeout: 8000,
        }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => {
                if (res.statusCode === 200 && chunks.length > 0) {
                    resolve(Buffer.concat(chunks));
                } else {
                    resolve(null);
                }
            });
        });

        req.on("error", () => resolve(null));
        req.on("timeout", () => { req.destroy(); resolve(null); });
        req.end();
    });
}

// ─── Send Queue Alert with Photo ───────────────────
export async function sendQueueAlertToTelegram(
    alertName: string,
    deviceName: string,
    deviceIp: string,
    username: string,
    password: string,
    channelName: string,
    peopleCount: number,
    threshold: number
): Promise<boolean> {
    const ratio = threshold > 0 ? peopleCount / threshold : 0;
    const severity = ratio >= 1.5 ? "CRITICO" : ratio >= 1 ? "LLENO" : "ALTO";
    const emoji = ratio >= 1.5 ? "\u{1F6A8}" : ratio >= 1 ? "\u{1F534}" : "\u{1F7E1}";

    const caption = [
        `${emoji} <b>Alerta de Aforo: ${alertName}</b>`,
        ``,
        `\u{1F4CD} <b>Ubicación:</b> ${channelName}`,
        `\u{1F4F7} <b>Dispositivo:</b> ${deviceName}`,
        `\u{1F465} <b>Personas:</b> ${peopleCount} / ${threshold}`,
        `\u{26A0}\u{FE0F} <b>Estado:</b> ${severity}`,
        `\u{1F552} <b>Hora:</b> ${fecha(new Date())}`,
    ].join("\n");

    return sendTelegramPhoto("", caption, deviceIp, username, password);
}
