// Captura el snapshot de la cámara de intrusión (directo a la cámara por su IP) y lo sube
// al bucket MinIO "intrusion", separado de LPR/Face. Actualiza Detection.snapshotPath.
const http = require("http");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const { uploadToS3 } = require("./lib-s3");
const prisma = new PrismaClient();

const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
function parseWWW(h) { const o = {}; (h || "").replace(/(\w+)=(?:"([^"]*)"|([^,]*))/g, (m, k, q, v) => { o[k] = q !== undefined ? q : (v || "").trim(); return m; }); return o; }
function digestHeader(user, pass, method, uri, wa) {
    const p = parseWWW(wa); const nc = "00000001", cnonce = crypto.randomBytes(8).toString("hex");
    const ha1 = md5(`${user}:${p.realm}:${pass}`), ha2 = md5(`${method}:${uri}`);
    const qop = p.qop ? p.qop.split(",")[0] : undefined;
    const resp = qop ? md5(`${ha1}:${p.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
    let h = `Digest username="${user}", realm="${p.realm}", nonce="${p.nonce}", uri="${uri}", response="${resp}"`;
    if (p.opaque) h += `, opaque="${p.opaque}"`;
    if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    return h;
}
function getBinary(ip, path, user, pass, timeout = 3500) {
    return new Promise((resolve) => {
        const doReq = (auth) => {
            const req = http.request({ host: ip, port: 80, path, method: "GET", timeout, headers: auth ? { Authorization: auth } : {} }, (res) => {
                if (res.statusCode === 401 && !auth) {
                    const wa = res.headers["www-authenticate"]; res.resume();
                    if (wa) doReq(digestHeader(user, pass, "GET", path, wa)); else resolve(null);
                    return;
                }
                if (res.statusCode !== 200) { res.resume(); return resolve(null); }
                const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => resolve(Buffer.concat(chunks))); res.on("error", () => resolve(null));
            });
            req.on("timeout", () => { try { req.destroy(); } catch {} resolve(null); });
            req.on("error", () => resolve(null));
            req.end();
        };
        doReq(null);
    });
}

// Captura directa a la cámara por su IP (Hik ISAPI picture / Dahua snapshot.cgi) y sube a intrusion.
async function captureForDevice(dev, detId) {
    try {
        if (!dev || !dev.ip) return null;
        const brand = String(dev.brand || "").toUpperCase();
        const user = dev.username || "admin", pass = dev.password || "";
        const path = brand === "DAHUA" ? "/cgi-bin/snapshot.cgi?channel=1" : "/ISAPI/Streaming/channels/101/picture";
        const buf = await getBinary(dev.ip, path, user, pass);
        if (!buf || buf.length < 1000) return null;
        const p = await uploadToS3(buf, `${detId}.jpg`, "image/jpeg", "intrusion");
        await prisma.detection.update({ where: { id: detId }, data: { snapshotPath: p } }).catch(() => {});
        return p;
    } catch (e) { return null; }
}

module.exports = { captureForDevice };
