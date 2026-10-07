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

// El logo para la foto de las alertas por WhatsApp, o null si está apagado (MARCA_AGUA_WHATSAPP=false).
async function marcaAguaFoto() {
    if ((await getSetting("MARCA_AGUA_WHATSAPP", "true")) === "false") return null;
    const fp = require("path").join(__dirname, "public", "marca-agua-omniaccess.png");
    return fs.existsSync(fp) ? fp : null;
}

// Fetch an image from the local web process and return base64 (no data-uri prefix).
function fetchLocalBase64(path) {
    return new Promise((resolve) => {
        const req = http.request({ hostname: "127.0.0.1", port: 10001, path, method: "GET", timeout: 12000 },
            (res) => {
                if (res.statusCode !== 200) { res.resume(); return resolve(null); }
                const chunks = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", async () => {
                    let buf = Buffer.concat(chunks);
                    if (buf.length <= 100) return resolve(null);
                    // Achicar a 1280 px / JPEG 82: una captura LPR de 2 MB llega a WhatsApp como
                    // "HD" con miniatura borrosa y botón de descarga; a ~200 KB se ve al instante.
                    try {
                        const sharp = require("sharp");
                        let img = sharp(await sharp(buf).rotate().resize({ width: 1280, withoutEnlargement: true }).toBuffer());
                        // Logo de OmniAccess (Ajustes → Video del evento; = AJUSTE_MARCA_AGUA y
                        // MARCA_AGUA_ANCHO/MARGEN de lib/clips). Con placa oscura: se lee sobre cualquier fondo.
                        const marca = await marcaAguaFoto();
                        if (marca) {
                            const { width = 1280, height = 720 } = await img.metadata();
                            const ancho = Math.round(width * 0.18), margen = Math.round(width * 0.02);
                            const logo = await sharp(marca).resize({ width: ancho }).toBuffer();
                            const alto = (await sharp(logo).metadata()).height || 0;
                            img = img.composite([{ input: logo, left: width - ancho - margen, top: Math.max(0, height - alto - margen) }]);
                        }
                        buf = await img.jpeg({ quality: 82 }).toBuffer();
                    } catch (e) { console.error("[dispatch] sharp:", e.message); }
                    resolve(buf.toString("base64"));
                });
            });
        req.on("error", () => resolve(null));
        req.on("timeout", () => { req.destroy(); resolve(null); });
        req.end();
    });
}

// ── Anillo de grabación local ──────────────────────────────────────────────
// Graba en segmentos cortos (go2rtc RTSP, -c copy) las cámaras que NO están en ningún NVR y
// que alguna regla de notificación activa alcanza, para que la alerta pueda llevar el clip del
// momento exacto con pre-roll. Las que están en un NVR no lo necesitan: el clip sale de su
// grabación (lib/clip-instante en la web, que también es quien corta el anillo).
//
// Antes sólo grababa las cámaras de fila (QUEUE_COUNTER, stream bosch_<ip>) y el clip lo
// armaba este proceso con su propio ffmpeg; en San Nicolás no había ninguna, así que el
// "Clip animado en alertas" nunca produjo nada. Las de fila siguen grabando como antes.
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
// Mismo directorio que lee la web (lib/clip-instante: DIR_ANILLO). Fuera de public: no se sirve.
const DIR_ANILLO = process.env.ANILLO_DIR || path.join(os.tmpdir(), "omniaccess-anillo");
const SEG_DUR = 2;      // seg por segmento (= SEG_ANILLO_SEG de lib/clips: la web corta con este valor)
const SEG_WRAP = 40;    // 40 × 2 s = 80 s de memoria: alcanza para el pre-roll más largo de una alerta (15 s) con margen
const recorders = new Map(); // deviceId -> { ch, src }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Qué tipos de equipo alcanza una regla "de cualquier cámara" según su módulo (= TIPOS_POR_MODULO de lib/clips).
const TIPOS_POR_MODULO = {
    LPR: ["LPR_CAMERA", "LPR_INTERIOR"],
    INTRUSION: ["CAMERA", "LPR_CAMERA", "LPR_INTERIOR"],
    // FACE: los terminales faciales no exponen un stream que go2rtc republique; su alerta va con la foto.
};

function startRecorder(deviceId, src) {
    const actual = recorders.get(deviceId);
    if (actual && actual.src === src) return;
    if (actual) stopRecorder(deviceId, false);
    const dir = path.join(DIR_ANILLO, deviceId);
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const args = ["-loglevel", "error", "-rtsp_transport", "tcp", "-fflags", "+genpts",
        "-i", src, "-an", "-c:v", "copy",
        "-f", "segment", "-segment_time", String(SEG_DUR), "-segment_wrap", String(SEG_WRAP),
        "-segment_format", "mpegts", "-reset_timestamps", "1", path.join(dir, "seg_%03d.ts")];
    let ch; try { ch = spawn("ffmpeg", args, { stdio: "ignore" }); } catch { return; }
    recorders.set(deviceId, { ch, src });
    console.log(`[anillo] graba ${deviceId} (${src})`);
    ch.on("exit", () => { const r = recorders.get(deviceId); if (r && r.ch === ch) recorders.delete(deviceId); });
    ch.on("error", () => { const r = recorders.get(deviceId); if (r && r.ch === ch) recorders.delete(deviceId); });
}

function stopRecorder(deviceId, borrar) {
    const r = recorders.get(deviceId);
    if (r) { try { r.ch.kill("SIGKILL"); } catch {} recorders.delete(deviceId); }
    if (borrar) { try { fs.rmSync(path.join(DIR_ANILLO, deviceId), { recursive: true, force: true }); } catch {} console.log(`[anillo] deja de grabar ${deviceId}`); }
}

/** El conjunto { deviceId → stream RTSP } que tiene que estar grabando ahora. */
async function conjuntoAGrabar() {
    const quiero = new Map();
    // Cámaras de fila (el primer barrio): como siempre.
    const filas = await prisma.device.findMany({ where: { deviceType: "QUEUE_COUNTER" }, select: { id: true, ip: true } });
    for (const d of filas) if (d.ip) quiero.set(d.id, `rtsp://127.0.0.1:8554/bosch_${String(d.ip).replace(/\./g, "_")}`);
    // Cámaras sin NVR alcanzadas por una regla activa, sólo si el clip en alertas está prendido:
    // con el interruptor apagado ningún clip se va a pedir y grabar sería CPU y disco tirados.
    if ((await getSetting("DISPATCH_ANIMATED", "false")) !== "true") return quiero;
    let mapa = {};
    try { mapa = JSON.parse(await getSetting("NVR_CHANNEL_MAP", "{}")) || {}; } catch {}
    // Sólo las reglas que mandan por un canal que lleva video (un aviso por correo no pide clip).
    const reglas = (await prisma.notificationRule.findMany({ where: { enabled: true }, select: { deviceId: true, modulo: true, channels: true } }))
        .filter((r) => /whatsapp|telegram/.test(String(r.channels || "")));
    const ids = new Set();
    const tipos = new Set();
    for (const r of reglas) {
        if (r.deviceId) ids.add(r.deviceId);
        else for (const t of (TIPOS_POR_MODULO[r.modulo] || [])) tipos.add(t);
    }
    if (!ids.size && !tipos.size) return quiero;
    const devs = await prisma.device.findMany({
        where: { OR: [{ id: { in: [...ids] } }, { deviceType: { in: [...tipos] } }] },
        select: { id: true, ip: true },
    });
    for (const d of devs) {
        if (d.ip && mapa[d.ip]) continue; // tiene NVR: el clip sale de la grabación
        quiero.set(d.id, `rtsp://127.0.0.1:8554/lpr_${d.id}`);
    }
    return quiero;
}

async function ensureRecorders() {
    try {
        const quiero = await conjuntoAGrabar();
        for (const [id, src] of quiero) startRecorder(id, src);
        for (const id of [...recorders.keys()]) if (!quiero.has(id)) stopRecorder(id, true);
        // Carpetas huérfanas (de un arranque anterior o de una cámara que ya no corresponde).
        let dirs = [];
        try { dirs = fs.readdirSync(DIR_ANILLO); } catch {}
        for (const d of dirs) if (!quiero.has(d)) { try { fs.rmSync(path.join(DIR_ANILLO, d), { recursive: true, force: true }); } catch {} }
    } catch (e) { console.error("[anillo] " + ((e && e.message) || e)); }
}

// El anillo viejo vivía dentro de public/clips (se podía servir): se borra.
try { fs.rmSync(path.join(__dirname, "public", "clips", "ring"), { recursive: true, force: true }); } catch {}
ensureRecorders();
setInterval(ensureRecorders, 30000);

// ── Clip de la alerta: lo corta la web (lib/clip-instante) ─────────────────
// Un solo lugar que sabe sacar video (NVR o anillo), el mismo del playback. Acá sólo se pide.
// Mismo directorio que la web (lib/clip-instante: DIR_CLIPS), fuera del proyecto.
const DIR_CLIPS = process.env.CLIPS_DIR || path.join(os.tmpdir(), "omniaccess-clips");
let _token = null;
async function trackingToken() {
    if (_token === null) _token = process.env.TRACKING_TOKEN || await getSetting("TRACKING_TOKEN", "");
    return _token;
}
/** → { ok:true, nombre, url, fuente } | { ok:false, motivo } — nunca lanza. */
function pedirClip(deviceId, instante) {
    return new Promise(async (resolve) => {
        const data = JSON.stringify({ deviceId, instante, para: "alerta" });
        const token = await trackingToken();
        const req = http.request({ hostname: "127.0.0.1", port: 10001, path: "/api/clip/instante", method: "POST",
            // Espera del tramo (≤30 s) + corte a tiempo real (≤45 s) + margen.
            timeout: 100000,
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), "x-tracking-token": token || "" } },
            (res) => { let d = ""; res.on("data", c => d += c); res.on("end", () => {
                try { const j = JSON.parse(d); resolve(j && typeof j === "object" ? j : { ok: false, motivo: "respuesta inválida" }); }
                catch { resolve({ ok: false, motivo: `la web contestó ${res.statusCode}` }); }
            }); });
        req.on("error", (e) => resolve({ ok: false, motivo: "la web no respondió: " + e.message }));
        req.on("timeout", () => { req.destroy(); resolve({ ok: false, motivo: "el clip tardó demasiado" }); });
        req.write(data); req.end();
    });
}

// OpenWA send-video (base64 mp4).
// ── WhatsApp por WAHA ──────────────────────────────────────────────────────
// El motor de WhatsApp es WAHA (devlikeapro/waha): /api/sendText, /api/sendImage,
// /api/sendVideo con {session, chatId, file:{mimetype,filename,data|url}, caption} y
// cabecera X-Api-Key. Estas funciones hablaban el dialecto de OpenWA
// (/api/sessions/<s>/messages/send-image, {base64}) que ya no corre en ningún barrio:
// cada despacho por WhatsApp moría con 404 "Cannot POST .../send-image".
function wahaPost(baseUrl, apiKey, ruta, cuerpo, timeout) {
    return new Promise((resolve) => {
        let u;
        try { u = new URL(`${baseUrl.replace(/\/+$/, "")}${ruta}`); }
        catch (e) { return resolve({ ok: false, body: "bad OPENWA_URL: " + e.message }); }
        const lib = u.protocol === "https:" ? https : http;
        const body = JSON.stringify(cuerpo);
        const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname, method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "X-Api-Key": apiKey || "" }, timeout: timeout || 25000 },
            (res) => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, body: d, status: res.statusCode })); });
        req.on("error", (e) => resolve({ ok: false, body: e.message }));
        req.on("timeout", () => { req.destroy(); resolve({ ok: false, body: "timeout" }); });
        req.write(body); req.end();
    });
}
function openwaSend(baseUrl, apiKey, session, chatId, text) {
    return wahaPost(baseUrl, apiKey, "/api/sendText", { session, chatId, text }, 15000);
}
function openwaSendImage(baseUrl, apiKey, session, chatId, base64, caption) {
    return wahaPost(baseUrl, apiKey, "/api/sendImage", { session, chatId, file: { mimetype: "image/jpeg", filename: "captura.jpg", data: base64 }, caption }, 30000);
}
function openwaSendVideo(baseUrl, apiKey, session, chatId, base64, caption) {
    return wahaPost(baseUrl, apiKey, "/api/sendVideo", { session, chatId, file: { mimetype: "video/mp4", filename: "clip.mp4", data: base64 }, caption }, 40000);
}
function openwaSendVideoUrl(baseUrl, apiKey, session, chatId, videoUrl, caption) {
    return wahaPost(baseUrl, apiKey, "/api/sendVideo", { session, chatId, file: { mimetype: "video/mp4", filename: "clip.mp4", url: videoUrl }, caption }, 40000);
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

/** POST JSON a una URL cualquiera (webhook externo), http o https. */
function postJson(url, cuerpo, secreto) {
    return new Promise((resolve) => {
        let u;
        try { u = new URL(url); } catch { return resolve({ ok: false, body: "URL inválida" }); }
        const lib = u.protocol === "https:" ? https : http;
        const headers = { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(cuerpo) };
        if (secreto) headers["Authorization"] = /^(Bearer|Basic) /i.test(secreto) ? secreto : `Bearer ${secreto}`;
        const req = lib.request({
            hostname: u.hostname,
            port: u.port || (u.protocol === "https:" ? 443 : 80),
            path: u.pathname + u.search,
            method: "POST", timeout: 15000, headers,
        }, (res) => {
            let d = "";
            res.on("data", (c) => d += c);
            res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, body: `${res.statusCode} ${d.slice(0, 200)}` }));
        });
        req.on("error", (e) => resolve({ ok: false, body: e.message }));
        req.on("timeout", () => { req.destroy(); resolve({ ok: false, body: "timeout" }); });
        req.write(cuerpo); req.end();
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
    // Nota que acompaña un envío exitoso (p. ej. "sin video: …"): se guarda en lastError con
    // estado SENT y despachos la muestra como aviso, no como falla.
    let notaVideoFinal = null;
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
            // El clip se pide una vez por despacho. Si el interruptor está prendido y no hay clip,
            // la alerta igual sale (con la foto) y el despacho guarda POR QUÉ no hubo video:
            // antes eso sólo quedaba en el log como "SIN CLIP (null)" y el panel decía "activo".
            let clip = null;
            let notaVideo = null;
            // Sin cámara (una prueba de canal, un aviso de sistema) no hay video que pedir ni nada que anotar.
            if (animated && dj.deviceId && (dj.channel === "whatsapp" || dj.channel === "telegram")) {
                {
                    const inst = Date.parse(p.instante || p.timestamp || "") || Number(p.alertTs) || new Date(dj.createdAt).getTime();
                    const r = await pedirClip(dj.deviceId, inst);
                    if (r && r.ok && r.nombre) clip = r;
                    else notaVideo = "sin video: " + ((r && r.motivo) || "no se pudo armar el clip");
                }
            }
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
                if (clip) {
                    r = await telegramSendAnimation(token, chat, base.replace(/\/+$/, "") + "/api/clip/" + clip.nombre, htmlText);
                    if (!r || !r.ok) notaVideo = "sin video: Telegram rechazó el clip (" + String((r && r.body) || "").slice(0, 80) + ")";
                }
                if (!r || !r.ok) {
                    const img = imageUrlFor(base, p.snapshotPath, dj.deviceId);
                    r = img ? await telegramSendPhoto(token, chat, img, htmlText) : await telegramSend(token, chat, htmlText);
                }
                if (!r.ok) throw new Error("Telegram: " + r.body);
            } else if (dj.channel === "whatsapp") {
                const url = await getSetting("OPENWA_URL", await getSetting("WAHA_URL", "http://192.168.99.22:2785"));
                const key = await getSetting("OPENWA_API_KEY", await getSetting("WAHA_API_KEY", ""));
                const session = await getSetting("OPENWA_SESSION", "default");
                const chatId = toChatId(p.chatId || p.to || await getSetting("OPENWA_DEFAULT_CHAT", ""));
                if (!chatId) throw new Error("Falta destinatario WhatsApp (OPENWA_DEFAULT_CHAT o payload.chatId)");
                let r;
                if (clip) {
                    // WAHA corre en el mismo equipo: baja el clip por la red interna. El valor por
                    // defecto era un IP del primer barrio (192.168.99.99), inalcanzable desde otro barrio.
                    const internalBase = await getSetting("INTERNAL_BASE_URL", "http://127.0.0.1:10001");
                    const vurl = internalBase.replace(/\/+$/, "") + "/api/clip/" + clip.nombre;
                    r = await openwaSendVideoUrl(url, key, session, chatId, vurl, text);
                    if (!r || !r.ok) {
                        console.error("[wa-video] url fail", r && r.status, ((r && r.body) || "").slice(0, 200), "(" + vurl + ")");
                        // Último recurso: el archivo en base64 (está en el mismo disco).
                        let b64 = null;
                        try { b64 = fs.readFileSync(path.join(DIR_CLIPS, clip.nombre)).toString("base64"); } catch {}
                        if (b64) r = await openwaSendVideo(url, key, session, chatId, b64, text);
                        if (!r || !r.ok) {
                            console.error("[wa-video] base64 fail", r && r.status, ((r && r.body) || "").slice(0, 200));
                            notaVideo = "sin video: WhatsApp rechazó el clip (" + String((r && (r.body || r.status)) || "").slice(0, 80) + ")";
                        } else console.log("[wa-video] OK por base64", clip.nombre);
                    } else { console.log("[wa-video] OK por URL", vurl, "fuente=" + clip.fuente); }
                } else if (notaVideo) { console.log("[wa-video] " + notaVideo + " device=" + dj.deviceId); }
                if (!r || !r.ok) {
                    const imgPath = imagePathFor(p.snapshotPath, dj.deviceId);
                    const b64 = imgPath ? await fetchLocalBase64(imgPath) : null;
                    r = b64 ? await openwaSendImage(url, key, session, chatId, b64, text) : await openwaSend(url, key, session, chatId, text);
                }
                if (!r.ok) throw new Error("WhatsApp: " + (r.body || r.status));
            } else if (dj.channel === "email") {
                const host = await getSetting("SMTP_HOST", process.env.SMTP_HOST);
                const port = Number(await getSetting("SMTP_PORT", process.env.SMTP_PORT || "587"));
                const user = await getSetting("SMTP_USER", process.env.SMTP_USER);
                const pass = await getSetting("SMTP_PASS", process.env.SMTP_PASS);
                const para = (p.to || await getSetting("SMTP_TO", process.env.SMTP_TO) || "").trim();
                if (!host) throw new Error("Falta el servidor SMTP");
                if (!para) throw new Error("Faltan destinatarios (SMTP_TO)");

                const nodemailer = require("nodemailer");
                // 465 va con TLS directo; 587 y 25 arrancan en claro y suben con STARTTLS.
                const transporte = nodemailer.createTransport({
                    host, port, secure: port === 465,
                    auth: user ? { user, pass } : undefined,
                    tls: { rejectUnauthorized: false },
                });
                const asunto = p.asunto || p.ruleName || "Alerta de OmniAccess";
                const img = imageUrlFor(base, p.snapshotPath, dj.deviceId);
                const r = await transporte.sendMail({
                    from: (await getSetting("SMTP_FROM", user || "omniaccess@localhost")),
                    to: para,
                    subject: asunto,
                    text,
                    html: `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.55">`
                        + `<p style="white-space:pre-wrap;margin:0 0 12px">${String(text).replace(/</g, "&lt;")}</p>`
                        + (img ? `<img src="${img}" alt="" style="max-width:520px;border-radius:8px">` : "")
                        + `</div>`,
                });
                if (!r || (r.rejected || []).length) throw new Error("SMTP rechazó: " + JSON.stringify(r.rejected));
            } else if (dj.channel === "webhook") {
                const url = await getSetting("DISPATCH_WEBHOOK_URL", process.env.DISPATCH_WEBHOOK_URL);
                const secreto = await getSetting("DISPATCH_WEBHOOK_SECRET", process.env.DISPATCH_WEBHOOK_SECRET);
                if (!url) throw new Error("Falta la URL del webhook");
                const cuerpo = JSON.stringify({
                    evento: p.evento || "alerta",
                    texto: text,
                    regla: p.ruleName || null,
                    dispositivo: p.deviceName || null,
                    deviceId: dj.deviceId || null,
                    canal: p.channelName || null,
                    valor: p.count ?? null,
                    umbral: p.threshold ?? null,
                    matricula: p.plate || null,
                    imagen: imageUrlFor(base, p.snapshotPath, dj.deviceId),
                    momento: new Date().toISOString(),
                    // Slack y Teams leen "text"; así el mismo POST sirve para los dos.
                    text,
                });
                const r = await postJson(url, cuerpo, secreto);
                if (!r.ok) throw new Error("Webhook: " + r.body);
            } else if (dj.channel === "webpush") {
                const title = p.ruleName || "Alerta de aforo";
                const body = `${p.deviceName || "Fila"} · aforo ${p.count}${p.threshold != null ? ` / umbral ${p.threshold}` : ""}`;
                const r = await postInternal("/api/push/dispatch", { title, body, url: "/pwa/filas" });
                if (!r.ok) throw new Error("WebPush: " + r.body);
            } else {
                throw new Error("Canal no soportado: " + dj.channel);
            }
            notaVideoFinal = notaVideo;
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
        await prisma.dispatchJob.update({ where: { id: dj.id }, data: { status: "SENT", sentAt: new Date(), lastError: notaVideoFinal, payload: { ...p, sentText } } });
    } catch (e) {
        const willRetry = (job.attemptsMade + 1) < (dj.maxAttempts || 5);
        await prisma.dispatchJob.update({ where: { id: dj.id }, data: { status: willRetry ? "PENDING" : "FAILED", lastError: String((e && e.message) || e) } });
        throw e; // surface to BullMQ for retry/backoff
    }
}

const worker = new Worker("dispatch", handle, { connection, concurrency: 4 });

// ── Clip sweeper: descarta clips generados viejos (robusto ante reinicios) ──
// Mismo directorio que la web; 10 min = CLIP_RETENCION_MIN de lib/clips (lo que WAHA/Telegram
// tardan en bajar el clip por URL, con margen). El anillo vive en otra carpeta y no se toca.
const CLIPS_DIR = DIR_CLIPS;
function sweepClips() {
    try {
        if (!fs.existsSync(CLIPS_DIR)) return;
        const now = Date.now();
        for (const f of fs.readdirSync(CLIPS_DIR)) {
            if (!/\.(mp4|txt)$/.test(f)) continue;
            const fp = path.join(CLIPS_DIR, f);
            try { const st = fs.statSync(fp); if (now - st.mtimeMs > 10 * 60 * 1000) fs.unlinkSync(fp); } catch {}
        }
    } catch {}
}
sweepClips();
setInterval(sweepClips, 60000);

worker.on("completed", (j) => console.log(`[dispatch-worker] ✅ completed ${j.id}`));
worker.on("failed", (j, e) => console.error(`[dispatch-worker] ❌ failed ${j && j.id}: ${e && e.message}`));
worker.on("error", (e) => console.error(`[dispatch-worker] error: ${e && e.message}`));
console.log("[dispatch-worker] started, consuming queue 'dispatch'");
