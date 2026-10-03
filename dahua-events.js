// Ingesta de eventos de intrusión de NVR Dahua (modelo pull: attach long-lived).
// Corre en el proceso webhooks (server.js). Usa global.io para emitir general_detection.
const http = require("http");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { captureForDevice } = require("./lib-intrusion-capture");

const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
function parseWWW(h) {
    const o = {};
    (h || "").replace(/(\w+)=(?:"([^"]*)"|([^,]*))/g, (m, k, q, v) => { o[k] = q !== undefined ? q : (v || "").trim(); return m; });
    return o;
}
function digestHeader(user, pass, method, uri, wa) {
    const p = parseWWW(wa);
    const nc = "00000001", cnonce = crypto.randomBytes(8).toString("hex");
    const ha1 = md5(`${user}:${p.realm}:${pass}`);
    const ha2 = md5(`${method}:${uri}`);
    const qop = p.qop ? p.qop.split(",")[0] : undefined;
    const resp = qop ? md5(`${ha1}:${p.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
    let h = `Digest username="${user}", realm="${p.realm}", nonce="${p.nonce}", uri="${uri}", response="${resp}"`;
    if (p.opaque) h += `, opaque="${p.opaque}"`;
    if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    return h;
}

const CODE_MAP = { CrossLineDetection: "LINECROSS", CrossRegionDetection: "INTRUSION", IntrusionDetection: "INTRUSION", SmartMotionHuman: "MOTION", VideoMotion: "MOTION" };
const lastEmit = {}; // throttle por nvr+canal+tipo

function attach(nvr) {
    const path = "/cgi-bin/eventManager.cgi?action=attach&codes=%5BCrossLineDetection,CrossRegionDetection,IntrusionDetection%5D&heartbeat=20";
    const user = nvr.username || "admin", pass = nvr.password || "";
    const doReq = (authHeader) => {
        const req = http.request({ host: nvr.ip, port: 80, path, method: "GET", headers: authHeader ? { Authorization: authHeader } : {} }, (res) => {
            if (res.statusCode === 401 && !authHeader) {
                const wa = res.headers["www-authenticate"];
                res.resume();
                if (wa) doReq(digestHeader(user, pass, "GET", path, wa));
                else retry(nvr);
                return;
            }
            if (res.statusCode !== 200) { res.resume(); return retry(nvr); }
            console.log(`[dahua-events] attach OK ${nvr.ip} (${nvr.name})`);
            let buf = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
                buf += chunk; if (buf.length > 65536) buf = buf.slice(-8192);
                let m; const re = /Code=([A-Za-z]+);action=(Start|Stop|Pulse);index=(\d+)/g;
                while ((m = re.exec(buf))) {
                    const [, code, action, idx] = m;
                    if (action === "Stop") continue;
                    const gtype = CODE_MAP[code]; if (!gtype) continue;
                    onEvent(nvr, code, gtype, parseInt(idx, 10)).catch(() => { });
                }
                const last = buf.lastIndexOf("Code=");
                if (last > 0) buf = buf.slice(last);
            });
            res.on("end", () => retry(nvr));
            res.on("error", () => retry(nvr));
        });
        req.on("error", () => retry(nvr));
        req.end();
    };
    doReq(null);
}

let CH_MAP_CACHE = null, CH_MAP_TS = 0;
async function channelMap() {
    if (CH_MAP_CACHE && Date.now() - CH_MAP_TS < 30000) return CH_MAP_CACHE;
    try {
        const row = await prisma.setting.findUnique({ where: { key: "NVR_CHANNEL_MAP" } });
        CH_MAP_CACHE = row ? JSON.parse(row.value) : {}; CH_MAP_TS = Date.now();
    } catch { CH_MAP_CACHE = CH_MAP_CACHE || {}; }
    return CH_MAP_CACHE;
}

async function onEvent(nvr, code, gtype, idx) {
    const ch = idx + 1; // Dahua index 0-based -> canal
    const key = `${nvr.id}:${ch}:${gtype}`;
    const now = Date.now();
    if (lastEmit[key] && now - lastEmit[key] < 8000) return; // throttle
    lastEmit[key] = now;
    let camId = null, camName = null, camDev = null;
    try {
        const map = await channelMap();
        for (const ip of Object.keys(map)) {
            const e = map[ip];
            if ((e.nvr || e.nvrId) === nvr.id && Number(e.ch) === ch) {
                const cam = await prisma.device.findFirst({ where: { ip }, select: { id: true, name: true, ip: true, brand: true, username: true, password: true } });
                if (cam) { camId = cam.id; camName = cam.name; camDev = cam; }
                break;
            }
        }
    } catch { }
    try {
        const det = await prisma.detection.create({ data: { deviceId: camId || nvr.id, type: gtype, eventType: code, timestamp: new Date() } });
        if (global.io) global.io.emit("general_detection", { id: det.id, deviceId: det.deviceId, deviceName: camName || nvr.name, type: gtype, eventType: code, timestamp: det.timestamp, source: "dahua", nvr: nvr.name, channel: ch });
        console.log(`[dahua-events] ${gtype} ${code} nvr=${nvr.name} ch=${ch} cam=${camName || "?"}`);
        if (camDev) { captureForDevice(camDev, det.id).then((p) => { if (p && global.io) global.io.emit("detection_snapshot", { id: det.id, snapshotPath: p }); }).catch(() => {}); }
    } catch (e) { console.error("[dahua-events] create:", e.message); }
}

const retryTimers = {};
function retry(nvr) {
    if (retryTimers[nvr.id]) return;
    retryTimers[nvr.id] = setTimeout(() => { retryTimers[nvr.id] = null; attach(nvr); }, 5000);
}

async function start() {
    try {
        const nvrs = await prisma.device.findMany({ where: { deviceType: "NVR", brand: "DAHUA" }, select: { id: true, ip: true, name: true, username: true, password: true } });
        if (!nvrs.length) { console.log("[dahua-events] sin NVR Dahua"); return; }
        for (const n of nvrs) { console.log(`[dahua-events] iniciando ${n.ip}`); attach(n); }
    } catch (e) { console.error("[dahua-events] start:", e.message); setTimeout(start, 10000); }
}

module.exports = { start };
