// Standalone BullMQ worker — consumes the "dispatch" queue and sends
// notifications/reports with retries. Run via PM2 (process: dispatch-worker).
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const https = require("https");
const http = require("http");
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const { execFile } = require("child_process");

const prisma = new PrismaClient();
const connection = new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});

async function getSetting(key, fallback) {
    try { const s = await prisma.setting.findUnique({ where: { key } }); return (s && s.value) || fallback; }
    catch { return fallback; }
}

function telegramSend(token, chatId, text) {
    return new Promise((resolve) => {
        const body = JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true });
        const req = https.request(`https://api.telegram.org/bot${token}/sendMessage`,
            { method: "POST", headers: { "Content-Type": "application/json" }, timeout: 12000 },
            (res) => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ ok: res.statusCode === 200, body: d })); });
        req.on("error", (e) => resolve({ ok: false, body: e.message }));
        req.on("timeout", () => { req.destroy(); resolve({ ok: false, body: "timeout" }); });
        req.write(body); req.end();
    });
}

function telegramSendPhoto(token, chatId, photoUrl, caption) {
    return new Promise((resolve) => {
        const body = JSON.stringify({ chat_id: chatId, photo: photoUrl, caption, parse_mode: "HTML" });
        const req = https.request(`https://api.telegram.org/bot${token}/sendPhoto`,
            { method: "POST", headers: { "Content-Type": "application/json" }, timeout: 20000 },
            (res) => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ ok: res.statusCode === 200, body: d })); });
        req.on("error", (e) => resolve({ ok: false, body: e.message }));
        req.on("timeout", () => { req.destroy(); resolve({ ok: false, body: "timeout" }); });
        req.write(body); req.end();
    });
}

// Resolve a public image URL: stored snapshot, else the live camera frame.
function imageUrlFor(base, snapshotPath, deviceId) {
    const b = (base || "https://omniaccess.infratec.com.uy").replace(/\/+$/, "");
    if (snapshotPath) {
        if (/^https?:\/\//i.test(snapshotPath)) return snapshotPath;
        if (snapshotPath.startsWith("/")) return b + snapshotPath;
        return b + "/api/files/lpr-prod/" + snapshotPath;
    }
    if (deviceId) return b + "/api/snapshot/" + deviceId;
    return null;
}

// Local path (served by the web process) for the snapshot image.
function imagePathFor(snapshotPath, deviceId) {
    if (snapshotPath) {
        if (/^https?:\/\//i.test(snapshotPath)) return null; // external, can't fetch locally
        if (snapshotPath.startsWith("/")) return snapshotPath;
        return "/api/files/lpr-prod/" + snapshotPath;
    }
    if (deviceId) return "/api/snapshot/" + deviceId;
    return null;
}

// Fetch an image from the local web process and return base64 (no data-uri prefix).
function fetchLocalBase64(path) {
    return new Promise((resolve) => {
        const req = http.request({ hostname: "127.0.0.1", port: 10001, path, method: "GET", timeout: 12000 },
            (res) => {
                if (res.statusCode !== 200) { res.resume(); return resolve(null); }
                const chunks = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () => { const buf = Buffer.concat(chunks); resolve(buf.length > 100 ? buf.toString("base64") : null); });
            });
        req.on("error", () => resolve(null));
        req.on("timeout", () => { req.destroy(); resolve(null); });
        req.end();
    });
}

// ── Ring-buffer recorder ──────────────────────────────────────────────────
// Graba continuamente las cámaras de fila (vía go2rtc RTSP, -c copy) en
// segmentos cortos, para poder extraer el clip del momento EXACTO de la alerta
// con pre-roll (se ve a la gente acercándose + el instante de las N personas).
const { spawn } = require("child_process");
const RING_ROOT = "/opt/OmniAccess/public/clips/ring";
const SEG_DUR = 2;      // seg por segmento
const SEG_WRAP = 40;    // anillo (~80s de buffer)
const CLIP_PRE = 5;     // seg antes de la alerta (pre-roll)
const CLIP_POST = 3;    // seg después de la alerta
const recorders = new Map(); // deviceId -> child
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function streamNameForIp(ip) { return "bosch_" + String(ip).replace(/\./g, "_"); }

function startRecorder(deviceId, ip) {
    if (recorders.has(deviceId)) return;
    const dir = `${RING_ROOT}/${deviceId}`;
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const src = `rtsp://127.0.0.1:8554/${streamNameForIp(ip)}`;
    const args = ["-loglevel", "error", "-rtsp_transport", "tcp", "-fflags", "+genpts",
        "-i", src, "-an", "-c:v", "copy",
        "-f", "segment", "-segment_time", String(SEG_DUR), "-segment_wrap", String(SEG_WRAP),
        "-segment_format", "mpegts", "-reset_timestamps", "1", `${dir}/seg_%03d.ts`];
    let ch; try { ch = spawn("ffmpeg", args, { stdio: "ignore" }); } catch { return; }
    recorders.set(deviceId, ch);
    ch.on("exit", () => { recorders.delete(deviceId); });
    ch.on("error", () => { recorders.delete(deviceId); });
}

async function ensureRecorders() {
    try {
        const devs = await prisma.device.findMany({ where: { deviceType: "QUEUE_COUNTER" }, select: { id: true, ip: true } });
        for (const d of devs) { if (d.ip && !recorders.has(d.id)) startRecorder(d.id, d.ip); }
    } catch {}
}

function ringSegments(deviceId) {
    const dir = `${RING_ROOT}/${deviceId}`;
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith(".ts")); } catch { return []; }
    return files.map(f => { const fp = `${dir}/${f}`; let m = 0; try { m = fs.statSync(fp).mtimeMs; } catch {} return { fp, m }; })
        .filter(x => x.m > 0).sort((a, b) => a.m - b.m);
}

// Clip centrado en el momento de la alerta, extraído del anillo (pre-roll + post).
async function buildClip(deviceId, alertTsMs) {
    const T = alertTsMs && alertTsMs > 0 ? alertTsMs : Date.now();
    try {
        // esperar a que el segmento posterior a la alerta esté en disco
        for (let i = 0; i < 14; i++) {
            const segs = ringSegments(deviceId);
            const newest = segs.length ? segs[segs.length - 1].m : 0;
            if (newest >= T + CLIP_POST * 1000) break;
            if (!segs.length && i > 4) break; // no hay grabador → fallback
            await sleep(500);
        }
        const lo = T - CLIP_PRE * 1000;
        const hi = T + (CLIP_POST + SEG_DUR) * 1000;
        const segs = ringSegments(deviceId).filter(s => s.m >= lo && s.m <= hi);
        if (segs.length) {
            const stamp = Date.now();
            const fname = `${deviceId}_${stamp}.mp4`;
            const out = `/opt/OmniAccess/public/clips/${fname}`;
            const listPath = `/opt/OmniAccess/public/clips/${deviceId}_${stamp}.txt`;
            fs.writeFileSync(listPath, segs.map(s => `file '${s.fp}'`).join("\n"));
            await new Promise((resolve, reject) => {
                execFile("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listPath,
                    "-vf", "scale=480:-2,fps=10", "-an", "-movflags", "+faststart", out],
                    { timeout: 25000 }, (err) => err ? reject(err) : resolve());
            });
            try { fs.unlinkSync(listPath); } catch {}
            let st; try { st = fs.statSync(out); } catch { st = null; }
            if (st && st.size >= 1500) {
                const base64 = fs.readFileSync(out).toString("base64");
                setTimeout(() => { try { fs.unlinkSync(out); } catch {} }, 120000);
                return { base64, rel: "/clips/" + fname };
            }
            try { fs.unlinkSync(out); } catch {}
        }
        return await buildClipLive(deviceId);
    } catch (e) { console.error("[clip] " + ((e && e.message) || e)); return await buildClipLive(deviceId).catch(() => null); }
}

// Fallback: graba 3s en vivo (comportamiento anterior, si el anillo no está listo).
async function buildClipLive(deviceId) {
    try {
        const dev = await prisma.device.findUnique({ where: { id: deviceId }, select: { ip: true } });
        if (!dev || !dev.ip) return null;
        const input = `http://127.0.0.1:1984/api/stream.mp4?src=${streamNameForIp(dev.ip)}`;
        const fname = `${deviceId}_live_${Date.now()}.mp4`;
        const out = `/opt/OmniAccess/public/clips/${fname}`;
        await new Promise((resolve, reject) => {
            execFile("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-t", "3", "-vf", "scale=480:-2,fps=10", "-an", "-movflags", "+faststart", out],
                { timeout: 18000 }, (err) => err ? reject(err) : resolve());
        });
        let st; try { st = fs.statSync(out); } catch { return null; }
        if (!st || st.size < 1500) { try { fs.unlinkSync(out); } catch {} return null; }
        const base64 = fs.readFileSync(out).toString("base64");
        setTimeout(() => { try { fs.unlinkSync(out); } catch {} }, 120000);
        return { base64, rel: "/clips/" + fname };
    } catch (e) { console.error("[clip-live] " + ((e && e.message) || e)); return null; }
}

// arrancar grabadores del anillo
ensureRecorders();
setInterval(ensureRecorders, 30000);

// OpenWA send-video (base64 mp4).
function openwaSendVideo(baseUrl, apiKey, session, chatId, base64, caption) {
    return new Promise((resolve) => {
        let u;
        try { u = new URL(`${baseUrl.replace(/\/+$/, "")}/api/sessions/${encodeURIComponent(session)}/messages/send-video`); }
        catch (e) { return resolve({ ok: false, body: "bad OPENWA_URL: " + e.message }); }
        const lib = u.protocol === "https:" ? https : http;
        const body = JSON.stringify({ chatId, base64, caption, mimetype: "video/mp4", filename: "aforo.mp4" });
        const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname, method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "X-API-Key": apiKey || "" }, timeout: 40000 },
            (res) => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, body: d, status: res.statusCode })); });
        req.on("error", (e) => resolve({ ok: false, body: e.message }));
        req.on("timeout", () => { req.destroy(); resolve({ ok: false, body: "timeout" }); });
        req.write(body); req.end();
    });
}

// Telegram sendAnimation (by public URL).
function telegramSendAnimation(token, chatId, animationUrl, caption) {
    return new Promise((resolve) => {
        const body = JSON.stringify({ chat_id: chatId, animation: animationUrl, caption, parse_mode: "HTML" });
        const req = https.request(`https://api.telegram.org/bot${token}/sendAnimation`,
            { method: "POST", headers: { "Content-Type": "application/json" }, timeout: 25000 },
            (res) => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ ok: res.statusCode === 200, body: d })); });
        req.on("error", (e) => resolve({ ok: false, body: e.message }));
        req.on("timeout", () => { req.destroy(); resolve({ ok: false, body: "timeout" }); });
        req.write(body); req.end();
    });
}

// OpenWA send-text. baseUrl like http://192.168.99.22:2785 (http or https).
function openwaSend(baseUrl, apiKey, session, chatId, text) {
    return new Promise((resolve) => {
        let u;
        try { u = new URL(`${baseUrl.replace(/\/+$/, "")}/api/sessions/${encodeURIComponent(session)}/messages/send-text`); }
        catch (e) { return resolve({ ok: false, body: "bad OPENWA_URL: " + e.message }); }
        const lib = u.protocol === "https:" ? https : http;
        const body = JSON.stringify({ chatId, text });
        const req = lib.request({
            hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
            path: u.pathname, method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "X-API-Key": apiKey || "" },
            timeout: 15000,
        }, (res) => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, body: d, status: res.statusCode })); });
        req.on("error", (e) => resolve({ ok: false, body: e.message }));
        req.on("timeout", () => { req.destroy(); resolve({ ok: false, body: "timeout" }); });
        req.write(body); req.end();
    });
}

// OpenWA send-video por URL publica (mas robusto que base64).
function openwaSendVideoUrl(baseUrl, apiKey, session, chatId, videoUrl, caption) {
    return new Promise((resolve) => {
        let u;
        try { u = new URL(`${baseUrl.replace(/\/+$/, "")}/api/sessions/${encodeURIComponent(session)}/messages/send-video`); }
        catch (e) { return resolve({ ok: false, body: "bad OPENWA_URL: " + e.message }); }
        const lib = u.protocol === "https:" ? https : http;
        const body = JSON.stringify({ chatId, url: videoUrl, mimetype: "video/mp4", filename: "aforo.mp4", caption });
        const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname, method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "X-API-Key": apiKey || "" }, timeout: 40000 },
            (res) => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, body: d, status: res.statusCode })); });
        req.on("error", (e) => resolve({ ok: false, body: e.message }));
        req.on("timeout", () => { req.destroy(); resolve({ ok: false, body: "timeout" }); });
        req.write(body); req.end();
    });
}
// OpenWA send-image (by base64).
function openwaSendImage(baseUrl, apiKey, session, chatId, base64, caption) {
    return new Promise((resolve) => {
        let u;
        try { u = new URL(`${baseUrl.replace(/\/+$/, "")}/api/sessions/${encodeURIComponent(session)}/messages/send-image`); }
        catch (e) { return resolve({ ok: false, body: "bad OPENWA_URL: " + e.message }); }
        const lib = u.protocol === "https:" ? https : http;
        const body = JSON.stringify({ chatId, base64, caption, mimetype: "image/jpeg", filename: "aforo.jpg" });
        const req = lib.request({
            hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
            path: u.pathname, method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "X-API-Key": apiKey || "" },
            timeout: 25000,
        }, (res) => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, body: d, status: res.statusCode })); });
        req.on("error", (e) => resolve({ ok: false, body: e.message }));
        req.on("timeout", () => { req.destroy(); resolve({ ok: false, body: "timeout" }); });
        req.write(body); req.end();
    });
}

// Build a public URL for the snapshot so OpenWA can fetch it.
function snapshotUrl(base, snapshotPath) {
    if (!snapshotPath) return null;
    const b = (base || "https://omniaccess.infratec.com.uy").replace(/\/+$/, "");
    if (/^https?:\/\//i.test(snapshotPath)) return snapshotPath;
    if (snapshotPath.startsWith("/")) return b + snapshotPath;
    return b + "/api/files/lpr-prod/" + snapshotPath;
}

// Normalize a phone/jid to a WhatsApp chatId (<digits>@c.us)
function toChatId(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    if (s.includes("@")) return s; // already a jid (c.us / g.us)
    const digits = s.replace(/[^0-9]/g, "");
    return digits ? `${digits}@c.us` : null;
}

function getInternal(path) {
    return new Promise((resolve) => {
        const req = http.request({ hostname: "127.0.0.1", port: 10001, path, method: "GET", timeout: 60000 },
            (res) => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, body: d })); });
        req.on("error", (e) => resolve({ ok: false, body: e.message }));
        req.on("timeout", () => { req.destroy(); resolve({ ok: false, body: "timeout" }); });
        req.end();
    });
}

function postInternal(path, bodyObj) {
    return new Promise((resolve) => {
        const data = JSON.stringify(bodyObj || {});
        const req = http.request({ hostname: "127.0.0.1", port: 10001, path, method: "POST", timeout: 30000, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
            (res) => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, body: d })); });
        req.on("error", (e) => resolve({ ok: false, body: e.message }));
        req.on("timeout", () => { req.destroy(); resolve({ ok: false, body: "timeout" }); });
        req.write(data); req.end();
    });
}

async function handle(job) {
    const { dispatchJobId } = job.data || {};
    const dj = await prisma.dispatchJob.findUnique({ where: { id: dispatchJobId } });
    if (!dj) return;
    await prisma.dispatchJob.update({ where: { id: dj.id }, data: { status: "PROCESSING", startedAt: new Date(), attempts: { increment: 1 } } });
    const p = dj.payload || {};
    let sentText = null;
    try {
        if (dj.type === "ALERT") {
            const text = p.text || (
                `🚨 ${p.ruleName || "Alerta de aforo"}\n` +
                `📍 ${p.deviceName || "Fila"} · ${p.channelName || "Aforo"}\n` +
                `Valor ${p.count} (umbral ${p.threshold})`
            );
            sentText = text;
            const base = await getSetting("PUBLIC_BASE_URL", "https://omniaccess.infratec.com.uy");
            const animated = (await getSetting("DISPATCH_ANIMATED", "false")) === "true";
            // Build the animated clip once (reused across channels of the same job)
            let clip = null;
            if (animated && dj.deviceId) clip = await buildClip(dj.deviceId, p.alertTs || (p.timestamp ? Date.parse(p.timestamp) : Date.now()));
            if (dj.channel === "telegram") {
                const token = await getSetting("TELEGRAM_BOT_TOKEN", process.env.TELEGRAM_BOT_TOKEN);
                const chat = p.chatId || await getSetting("TELEGRAM_CHAT_ID", process.env.TELEGRAM_CHAT_ID);
                if (!token || !chat) throw new Error("Faltan credenciales de Telegram");
                const htmlText = p.text || (
                    `🚨 <b>${p.ruleName || "Alerta de aforo"}</b>\n` +
                    `📍 ${p.deviceName || "Fila"} · ${p.channelName || "Aforo"}\n` +
                    `Valor <b>${p.count}</b> (umbral ${p.threshold})`
                );
                let r;
                if (clip) r = await telegramSendAnimation(token, chat, base.replace(/\/+$/, "") + "/api/clip/" + ((clip.rel || "").split("/").pop()), htmlText);
                if (!r || !r.ok) {
                    const img = imageUrlFor(base, p.snapshotPath, dj.deviceId);
                    r = img ? await telegramSendPhoto(token, chat, img, htmlText) : await telegramSend(token, chat, htmlText);
                }
                if (!r.ok) throw new Error("Telegram: " + r.body);
            } else if (dj.channel === "whatsapp") {
                const url = await getSetting("OPENWA_URL", await getSetting("WAHA_URL", "http://192.168.99.22:2785"));
                const key = await getSetting("OPENWA_API_KEY", await getSetting("WAHA_API_KEY", ""));
                const session = await getSetting("OPENWA_SESSION", "omniaccess");
                const chatId = toChatId(p.chatId || p.to || await getSetting("OPENWA_DEFAULT_CHAT", ""));
                if (!chatId) throw new Error("Falta destinatario WhatsApp (OPENWA_DEFAULT_CHAT o payload.chatId)");
                let r;
                if (clip) {
                    const fileName = (clip.rel || "").split("/").pop();
                    const internalBase = await getSetting("INTERNAL_BASE_URL", "http://192.168.99.99:10001");
                    const vurl = internalBase.replace(/\/+$/, "") + "/api/clip/" + fileName;
                    r = await openwaSendVideoUrl(url, key, session, chatId, vurl, text);
                    if (!r || !r.ok) {
                        console.error("[wa-video] url fail", r && r.status, ((r && r.body) || "").slice(0, 200), "(" + vurl + ")");
                        // ultimo recurso: base64 (suele superar el limite de body de OpenWA)
                        r = await openwaSendVideo(url, key, session, chatId, clip.base64, text);
                        if (!r || !r.ok) console.error("[wa-video] base64 fail", r && r.status, ((r && r.body) || "").slice(0, 200));
                        else console.log("[wa-video] OK por base64", clip.rel);
                    } else { console.log("[wa-video] OK por URL", vurl); }
                } else { console.log("[wa-video] SIN CLIP (null) device=" + dj.deviceId); }
                if (!r || !r.ok) {
                    const imgPath = imagePathFor(p.snapshotPath, dj.deviceId);
                    const b64 = imgPath ? await fetchLocalBase64(imgPath) : null;
                    r = b64 ? await openwaSendImage(url, key, session, chatId, b64, text) : await openwaSend(url, key, session, chatId, text);
                }
                if (!r.ok) throw new Error("WhatsApp: " + (r.body || r.status));
            } else if (dj.channel === "webpush") {
                const title = p.ruleName || "Alerta de aforo";
                const body = `${p.deviceName || "Fila"} · aforo ${p.count}${p.threshold != null ? ` / umbral ${p.threshold}` : ""}`;
                const r = await postInternal("/api/push/dispatch", { title, body, url: "/pwa/filas" });
                if (!r.ok) throw new Error("WebPush: " + r.body);
            } else {
                throw new Error("Canal no soportado: " + dj.channel);
            }
        } else if (dj.type === "REPORT") {
            // Reuse the existing report generation/send endpoint (GET ?period=&deviceId=).
            const period = p.period || "daily";
            sentText = "Reporte " + period + (p.deviceName ? " - " + p.deviceName : "");
            const qs = "period=" + encodeURIComponent(period) + (p.deviceId ? "&deviceId=" + encodeURIComponent(p.deviceId) : "");
            const r = await getInternal("/api/queue/report/send?" + qs);
            if (!r.ok) throw new Error("Reporte: " + r.body);
        } else {
            throw new Error("Tipo desconocido: " + dj.type);
        }
        await prisma.dispatchJob.update({ where: { id: dj.id }, data: { status: "SENT", sentAt: new Date(), lastError: null, payload: { ...p, sentText } } });
    } catch (e) {
        const willRetry = (job.attemptsMade + 1) < (dj.maxAttempts || 5);
        await prisma.dispatchJob.update({ where: { id: dj.id }, data: { status: willRetry ? "PENDING" : "FAILED", lastError: String((e && e.message) || e) } });
        throw e; // surface to BullMQ for retry/backoff
    }
}

const worker = new Worker("dispatch", handle, { connection, concurrency: 4 });

// ── Clip sweeper: descarta clips generados viejos (robusto ante reinicios) ──
const CLIPS_DIR = "/opt/OmniAccess/public/clips";
function sweepClips() {
    try {
        if (!fs.existsSync(CLIPS_DIR)) return;
        const now = Date.now();
        for (const f of fs.readdirSync(CLIPS_DIR)) {
            if (!f.endsWith(".mp4")) continue;
            const fp = CLIPS_DIR + "/" + f;
            try { const st = fs.statSync(fp); if (now - st.mtimeMs > 5 * 60 * 1000) fs.unlinkSync(fp); } catch {}
        }
    } catch {}
}
sweepClips();
setInterval(sweepClips, 60000);

worker.on("completed", (j) => console.log(`[dispatch-worker] ✅ completed ${j.id}`));
worker.on("failed", (j, e) => console.error(`[dispatch-worker] ❌ failed ${j && j.id}: ${e && e.message}`));
worker.on("error", (e) => console.error(`[dispatch-worker] error: ${e && e.message}`));
console.log("[dispatch-worker] started, consuming queue 'dispatch'");
