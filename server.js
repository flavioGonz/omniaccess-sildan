const path = require("path");
process.env.TZ = 'America/Montevideo';
require("dotenv").config({ path: path.join(__dirname, '.env') });

console.log("DEBUG ENV: Loading .env from", path.join(__dirname, '.env'));

// Robust URL selection
const fallbackUrl = "postgresql://postgres:eElbebe*2011@192.168.99.111:5432/lpr_db?schema=public";
const dbUrl = process.env.DATABASE_URL || fallbackUrl;
const isUsingFallback = !process.env.DATABASE_URL;

// Mask password for logs
const maskedUrl = dbUrl.replace(/:([^@]+)@/, ":****@");

console.log(`DEBUG ENV: DATABASE_URL status: ${isUsingFallback ? "USING FALLBACK 🛡️" : "LOADED FROM .ENV ✅"}`);
console.log(`DEBUG ENV: Target Database: ${maskedUrl}`);

const { createServer } = require("https");
const http = require("http");
const { PrismaClient } = require("@prisma/client");
const { Server } = require("socket.io");
const { XMLParser } = require("fast-xml-parser");
const fs = require("fs");
const fsPromises = require("fs/promises");
const Busboy = require("busboy");

const axios = require("axios");
const https = require("https");
const crypto = require("crypto");
const { uploadToS3 } = require("./lib-s3");
const { getVehicleColorName, getVehicleBrandName } = require("./hikvision-codes");
const { handleWahaWebhook, sendWahaText } = require("./waha-handler");
const webpush = require('web-push');

// Configure Web Push
if (process.env.VAPID_PRIVATE_KEY) {
    try {
        webpush.setVapidDetails(
            process.env.VAPID_SUBJECT || 'mailto:admin@omniaccess.com',
            process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
            process.env.VAPID_PRIVATE_KEY
        );
        console.log("✅ Web Push Configured");
    } catch (e) {
        console.error("❌ Web Push Config Error:", e.message);
    }
}

const sendPushToAll = async (payload) => {
    try {
        const subsPath = path.join(__dirname, 'push_subs.json');
        if (!fs.existsSync(subsPath)) return;

        const data = fs.readFileSync(subsPath, 'utf-8');
        const subscriptions = JSON.parse(data);

        console.log(`[PUSH] Sending to ${subscriptions.length} devices...`);

        const notificationPayload = JSON.stringify(payload);

        const promises = subscriptions.map(sub =>
            webpush.sendNotification(sub, notificationPayload)
                .catch(err => {
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        // In a real app, we would remove the subscription here
                        return;
                    }
                    console.error("[PUSH] Send error:", err.message);
                })
        );

        await Promise.all(promises);
    } catch (error) {
        console.error("[PUSH] Broadcast error:", error);
    }
};

// Configure axios defaults for device communication
const agent = new https.Agent({
    rejectUnauthorized: false
});
axios.defaults.httpsAgent = agent;
axios.defaults.headers.common['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
axios.defaults.headers.common['Accept'] = '*/*';

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: dbUrl,
        },
    },
});
const hostname = process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.WEBHOOK_PORT || "10000", 10);

console.log(`\x1b[36m%s\x1b[0m`, `🚀 SERVIDOR UNIFICADO v10.5 ACTIVE`);
console.log("DEBUG: Prisma initialized with URL length:", process.env.DATABASE_URL ? process.env.DATABASE_URL.length : "NULL");

// Helper to validate image bytes
const isValidImage = (buffer, contentType) => {
    if (!buffer || buffer.length < 100) return false;
    if (contentType && contentType.includes('image/')) return true;
    const header = buffer.slice(0, 4);
    if (header[0] === 0xFF && header[1] === 0xD8) return true;
    if (header[0] === 0x89 && header[1] === 0x50) return true;
    return false;
};

// Helpers for formatted S3 filenames
const formatEventDate = (date) => {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${day}-${month}-${year}-${hours}-${minutes}`;
};

const sanitizeName = (name) => {
    return (name || "unknown").toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
};

const generateId = () => {
    // Generates a short unique ID similar to cuid/uuid but shorter for filenames
    return Math.random().toString(36).substring(2, 9);
};

// Helper for Auto-Adopting Devices from Discovery
const adoptDevice = async (mac, ip, brand, deviceType = 'LPR_CAMERA') => {
    try {
        const normalizeMac = (m) => m ? String(m).replace(/[:-\s]/g, "").toUpperCase() : null;
        const cleanMac = normalizeMac(mac);
        const cleanIp = ip ? String(ip).replace(/^.*:/, '') : null;

        if (!cleanMac && !cleanIp) return null;

        // Final check before creation to avoid duplicates
        const all = await prisma.device.findMany();
        const existing = all.find(d => 
            (cleanMac && normalizeMac(d.mac) === cleanMac) || 
            (cleanIp && d.ip === cleanIp)
        );
        
        if (existing) return existing;

        const newDevice = await prisma.device.create({
            data: {
                name: `NUEVO: ${brand} (${cleanMac || cleanIp})`,
                brand: brand,
                deviceType: deviceType,
                ip: cleanIp || '0.0.0.0',
                mac: cleanMac,
                direction: 'ENTRY',
                authType: 'BASIC',
                doorStatus: 'UNKNOWN',
                username: 'admin', // Placeholder for manual update
                password: '',      // Placeholder for manual update
            }
        });
        
        console.log(`[Discovery] 🆕 Device auto-adopted: ${newDevice.name} [${brand}]`);
        
        if (global.io) {
            global.io.emit("device_adopted", newDevice);
        }
        
        return newDevice;
    } catch (e) {
        console.error(`[Discovery] ❌ Failed to adopt device: ${e.message}`);
        return null;
    }
};

// Helper for Camera Snapshots (Basic/Digest)
const fetchCameraSnapshot = async (device) => {
    let baseUrl = device.ip.startsWith('http') ? device.ip : `http://${device.ip}`;
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

    const isSPA = (device.name && device.name.toUpperCase().includes("SPA"));
    const isTorre = (device.name && device.name.toUpperCase().includes("TORRE"));
    const isAndroid = (device.brand === 'AKUVOX' && device.deviceModel && ["R29", "A05", "E16", "E18", "X915"].some(m => device.deviceModel.toUpperCase().includes(m)));

    // Priority: SPA, Torre and Android models go to 8080 first
    const ports = (device.brand === 'AKUVOX') ? ((isSPA || isTorre || isAndroid) ? ['8080', null] : [null, '8080']) : [null];

    let basePaths = [];
    if (device.brand === 'AKUVOX') {
        basePaths = (isSPA || isTorre) ? [
            "/picture.jpg",
            "/picture.cgi",
            "/jpeg.cgi",
            "/video.cgi",
            "/api/camera/snapshot",
            "/fcgi/do?action=mjpeg"
        ] : [
            "/api/camera/snapshot",
            "/video.cgi",
            "/picture.cgi",
            "/picture.jpg",
            "/jpeg.cgi",
            "/fcgi/video.cgi",
            "/fcgi/do?action=mjpeg",
            "/fcgi/do?action=Snapshot",
            "/fcgi/video.cgi?action=snapshot",
            "/live.mjpg",
            "/video.mjpg",
            "/fcgi?action=snapshot",
            "/fcgi-bin/snapshot.fcgi",
            "/snapshot.jpg",
            "/jpg/image.jpg",
            "/cgi-bin/snapshot.cgi"
        ];
    } else if (device.brand === 'HIKVISION') {
        basePaths = ["/ISAPI/Streaming/channels/1/picture"];
    } else if (device.brand === 'DAHUA') {
        basePaths = ["/cgi-bin/snapshot.cgi"];
    } else {
        basePaths = ["/fcgi-bin/snapshot.fcgi", "/cgi-bin/snapshot.cgi", "/snapshot.jpg"];
    }

    const authHeaderBasic = "Basic " + Buffer.from(`${device.username}:${device.password}`).toString("base64");
    // console.log(`\n[Snap-v7] 🔍 ${device.name} (${device.ip})`);

    for (const port of ports) {
        let currentBaseUrl = baseUrl;
        if (port) {
            try {
                const urlObj = new URL(baseUrl);
                urlObj.port = port;
                currentBaseUrl = urlObj.toString();
                if (currentBaseUrl.endsWith('/')) currentBaseUrl = currentBaseUrl.slice(0, -1);
            } catch (e) {
                currentBaseUrl = `${baseUrl}:${port}`;
            }
        }

        // console.log(`[Snap] 🔌 Trying port: ${port || 'default'}`);

        for (const path of basePaths) {
            const urlToTry = currentBaseUrl + path;

            // Strategy 1: NO-AUTH (per user's direct request)
            try {
                const response = await axios.get(urlToTry, {
                    responseType: 'arraybuffer',
                    timeout: 2500,
                    validateStatus: s => s === 200
                });
                if (isValidImage(response.data, response.headers['content-type'])) {
                    // console.log(`[Snap] ✓ SUCCESS! ${path} (Port: ${port || 'default'}) [No-Auth]`);
                    return response.data;
                }
            } catch (e) {
                // If 401, we handle below
            }

            // Strategy 2: DIGEST/BASIC (Calculated based on 401 response)
            try {
                const firstRes = await axios.get(urlToTry, { validateStatus: s => true, timeout: 3000 });

                if (firstRes.status === 401) {
                    const wwwAuth = firstRes.headers["www-authenticate"] || "";
                    if (wwwAuth.toLowerCase().includes("digest")) {
                        // console.log(`[Snap] 🔐 401 Digest detected on ${path}. Negotiating...`);
                        const digestResult = await tryFetchWithDigest(urlToTry, path, device);
                        if (digestResult) {
                            // console.log(`[Snap] ✓ SUCCESS! ${path} via Digest`);
                            return digestResult;
                        }
                    } else if (wwwAuth.toLowerCase().includes("basic")) {
                        const resBasic = await axios.get(urlToTry, {
                            headers: { 'Authorization': authHeaderBasic },
                            responseType: 'arraybuffer',
                            timeout: 4000
                        });
                        if (isValidImage(resBasic.data, resBasic.headers['content-type'])) {
                            // console.log(`[Snap] ✓ SUCCESS! ${path} [Basic]`);
                            return resBasic.data;
                        }
                    }
                }
            } catch (error) {
                if (error.code === 'ECONNREFUSED' && port) break;
            }
        }
    }

    console.warn(`[Snap] ✗ FAILED - No valid image found for ${device.name}`);
    return null;
};

// Helper for Digest fetch
const tryFetchWithDigest = async (url, path, device, method = "GET") => {
    try {
        // First call to get nonce (with no auth)
        const firstRes = await axios({
            method: method,
            url: url,
            validateStatus: () => true,
            timeout: 5000,
            headers: { 'Connection': 'close' },
            httpsAgent: agent
        }).catch(e => e.response);

        if (!firstRes || firstRes.status !== 401) return null;

        const wwwAuth = firstRes.headers["www-authenticate"] || firstRes.headers["www-authenticate".toLowerCase()];
        if (!wwwAuth || !wwwAuth.toLowerCase().includes("digest")) {
            // Fallback: If it's a 401 but no Digest, maybe it wants simple Basic?
            const basicHeader = "Basic " + Buffer.from(`${device.username}:${device.password}`).toString("base64");
            const basicRetry = await axios({
                method: method,
                url: url,
                headers: { 'Authorization': basicHeader, 'Connection': 'close' },
                responseType: 'arraybuffer',
                timeout: 5000,
                httpsAgent: agent,
                validateStatus: (s) => s === 200
            }).catch(() => null);
            if (basicRetry && isValidImage(basicRetry.data)) return basicRetry.data;
            return null;
        }

        const getVal = (key) => {
            const match = wwwAuth.match(new RegExp(`${key}="?([^",]+)"?`, 'i'));
            return match ? match[1] : null;
        };

        const realm = getVal("realm") || "HTTPAPI";
        const nonce = getVal("nonce");
        const qop = getVal("qop");
        const opaque = getVal("opaque");
        const algorithmFromDevice = getVal("algorithm"); const cnonce = crypto.randomBytes(8).toString("hex"); const algorithm = (algorithmFromDevice || "MD5").toUpperCase();

        if (!nonce) return null;

        let ha1 = crypto.createHash("md5").update(`${device.username}:${realm}:${device.password}`).digest("hex");
        if (algorithm === "MD5-SESS") {
            ha1 = crypto.createHash("md5").update(`${ha1}:${nonce}:${cnonce}`).digest("hex");
        }
        
        const ha2 = crypto.createHash("md5").update(`${method}:${path}`).digest("hex");
        const nc = "00000001";

        let responseStr;
        if (qop === 'auth' || qop === 'auth-int') {
            responseStr = crypto.createHash("md5").update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`).digest("hex");
        } else {
            responseStr = crypto.createHash("md5").update(`${ha1}:${nonce}:${ha2}`).digest("hex");
        }

        let authParts = [
            `Digest username="${device.username}"`,
            `realm="${realm}"`,
            `nonce="${nonce}"`,
            `uri="${path}"`,
            `response="${responseStr}"`
        ];
        if (opaque) authParts.push(`opaque="${opaque}"`);
        if (qop) {
            authParts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
        }
        if (algorithmFromDevice) authParts.push(`algorithm=${algorithmFromDevice}`);

        const retryResponse = await axios({
            method: method,
            url: url,
            headers: { 'Authorization': authParts.join(', '), 'Connection': 'close' },
            responseType: 'arraybuffer',
            timeout: 5000,
            httpsAgent: agent,
            validateStatus: (status) => true
        });

        if (retryResponse.status === 200 && isValidImage(retryResponse.data, retryResponse.headers['content-type'])) {
            return retryResponse.data;
        }
    } catch (e) {
        console.error(`[Digest Error] ${device.ip}: ${e.message}`);
    }
    return null;
};

/**
 * Proxy direct MJPEG stream from device to response
 */
const proxyVideoStream = async (device, res, req) => {
    let baseUrl = device.ip.startsWith('http') ? device.ip : `http://${device.ip}`;
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

    const isSPA = (device.name && device.name.toUpperCase().includes("SPA"));
    const isTorre = (device.name && device.name.toUpperCase().includes("TORRE"));
    const isAndroid = (device.deviceModel && ["R29", "A05", "E16", "E18", "X915"].some(m => device.deviceModel.toUpperCase().includes(m)));
    const ports = (device.brand === 'AKUVOX') ? ((isSPA || isTorre || isAndroid) ? ['8080', null] : [null, '8080']) : [null];

    const endpoints = [
        "/ISAPI/Streaming/channels/101/httppreview",
        "/ISAPI/Streaming/channels/102/httppreview",
        "/ISAPI/Streaming/channels/1/httppreview",
        "/ISAPI/Streaming/channels/2/httppreview",
        "/video.cgi",
        "/fcgi/video.cgi",
        "/fcgi/do?action=mjpeg",
        "/live.mjpg",
        "/video.mjpg",
        "/cgi-bin/mjpg/video.cgi?subtype=1"
    ];

    const authHeaderBasic = "Basic " + Buffer.from(`${device.username}:${device.password}`).toString("base64");

    let activeSource = null;
    let isClosed = false;

    // Monitor client disconnection to stop everything immediately
    const cleanup = () => {
        if (isClosed) return;
        isClosed = true;
        console.log(`[Proxy] Client disconnected. Closing stream for ${device.name}.`);
        if (activeSource) {
            if (typeof activeSource.destroy === 'function') activeSource.destroy();
            // Force socket destruction to ensure camera stops sending
            if (activeSource.socket && typeof activeSource.socket.destroy === 'function') {
                activeSource.socket.destroy();
            }
        }
    };

    res.on('close', cleanup);
    res.on('finish', cleanup);
    if (req) req.on('close', cleanup);

    for (const port of ports) {
        if (isClosed) break;
        let currentBaseUrl = baseUrl;
        if (port) {
            try {
                const urlObj = new URL(baseUrl);
                urlObj.port = port;
                currentBaseUrl = urlObj.toString();
                if (currentBaseUrl.endsWith('/')) currentBaseUrl = currentBaseUrl.slice(0, -1);
            } catch (e) { currentBaseUrl = `${baseUrl}:${port}`; }
        }

        for (const path of endpoints) {
            if (isClosed) break;
            const streamUrl = currentBaseUrl + path;
            console.log(`[Proxy] Trying MJPEG Source: ${streamUrl}`);

            try {
                let sourceRes;
                try {
                    sourceRes = await axios.get(streamUrl, {
                        responseType: 'stream',
                        timeout: 3000,
                        validateStatus: (status) => status === 200,
                        headers: { 'Connection': 'close' }
                    });
                } catch (e) {
                    if (isClosed) break;
                    if (e.response?.status === 401) {
                        const wwwAuth = e.response.headers["www-authenticate"] || "";
                        if (wwwAuth.toLowerCase().includes("digest")) {
                            console.log(`[Proxy] 🔐 401 Digest detected on ${path}, negotiating challenge...`);
                            sourceRes = await tryStreamWithDigest(streamUrl, path, device);
                        } else {
                            console.log(`[Proxy] Trying BASIC-AUTH: ${streamUrl}`);
                            sourceRes = await axios.get(streamUrl, {
                                headers: { 'Authorization': authHeaderBasic, 'Connection': 'close' },
                                responseType: 'stream',
                                timeout: 5000,
                                validateStatus: (status) => status === 200
                            });
                        }
                    } else { throw e; }
                }

                if (sourceRes && sourceRes.data) {
                    activeSource = sourceRes.data;
                    const contentType = (sourceRes.headers['content-type'] || '').toLowerCase();

                    if (!contentType.includes('multipart/')) {
                        console.log(`[Proxy] ⚠️ ${path} is not a multipart stream (${contentType}). Skipping...`);
                        activeSource.destroy();
                        activeSource = null;
                        continue;
                    }

                    if (isClosed) {
                        activeSource.destroy();
                        return true;
                    }

                    console.log(`[Proxy] ✓ Stream STABLE (${contentType}) at ${path}. Piping...`);
                    res.writeHead(200, {
                        'Content-Type': contentType,
                        'Cache-Control': 'no-cache',
                        'Connection': 'close',
                        'Pragma': 'no-cache'
                    });

                    activeSource.pipe(res);
                    return true;
                }
            } catch (error) {
                if (isClosed) break;
                if (error.response?.status !== 404) {
                    console.log(`[Proxy] ✗ ${path} -> ${error.response?.status || error.code}`);
                }
            }
        }
    }
    return false;
};

/**
 * Special helper for Digest Streaming
 */
const tryStreamWithDigest = async (url, path, device) => {
    try {
        const firstRes = await axios.get(url, { validateStatus: () => true, timeout: 5000, headers: { 'Connection': 'close' } }).catch(e => e.response);
        const wwwAuth = firstRes.headers["www-authenticate"] || firstRes.headers["www-authenticate".toLowerCase()];
        if (!wwwAuth || !wwwAuth.toLowerCase().includes("digest")) return null;

        console.log(`[Digest-Stream] Challenge from ${device.ip}: ${wwwAuth}`);

        const getVal = (key) => {
            const match = wwwAuth.match(new RegExp(`${key}="?([^",]+)"?`, 'i'));
            return match ? match[1] : null;
        };

        const realm = getVal("realm") || "HTTPAPI";
        const nonce = getVal("nonce");
        const qop = getVal("qop");
        const opaque = getVal("opaque");
        const algorithmFromDevice = getVal("algorithm"); const cnonce = crypto.randomBytes(8).toString("hex"); const algorithm = (algorithmFromDevice || "MD5").toUpperCase();

        if (!nonce) return null;

        let ha1 = crypto.createHash("md5").update(`${device.username}:${realm}:${device.password}`).digest("hex");
        if (algorithm === "MD5-SESS") {
            ha1 = crypto.createHash("md5").update(`${ha1}:${nonce}:${cnonce}`).digest("hex");
        }
        
        const ha2 = crypto.createHash("md5").update(`GET:${path}`).digest("hex");
        const nc = "00000001";
        let responseStr;
        if (qop === 'auth' || qop === 'auth-int') {
            responseStr = crypto.createHash("md5").update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`).digest("hex");
        } else {
            responseStr = crypto.createHash("md5").update(`${ha1}:${nonce}:${ha2}`).digest("hex");
        }

        let authParts = [
            `Digest username="${device.username}"`,
            `realm="${realm}"`,
            `nonce="${nonce}"`,
            `uri="${path}"`,
            `response="${responseStr}"`
        ];

        if (algorithmFromDevice) authParts.push(`algorithm=${algorithmFromDevice}`);
        if (opaque) authParts.push(`opaque="${opaque}"`);
        if (qop) {
            authParts.push(`qop=${qop}`);
            authParts.push(`nc=${nc}`);
            authParts.push(`cnonce="${cnonce}"`);
        }

        const authHeader = authParts.join(', ');
        console.log(`[Digest-Stream] -> Sending Header to ${device.ip}`);

        return await axios.get(url, {
            headers: {
                'Authorization': authHeader,
                'Connection': 'close'
            },
            responseType: 'stream',
            timeout: 15000
        });
    } catch (e) {
        console.error(`[Digest Stream Error] ${e.message}`);
        return null;
    }
};

// Helper to construct Akuvox Face URL according to "Rule of Gold"
const getAkuvoxFaceFilename = (date, time) => {
    // Rule: YYYY-MM-DD_H-m-s.jpg (stripping leading zeros from time)
    const cleanTime = time.split(':').map(t => parseInt(t, 10)).join('-');
    return `${date}_${cleanTime}.jpg`;
};

/**
 * Fetch face/event image from Akuvox device
 * Akuvox doesn't support snapshot capture - we must use doorlog API or user profile
 * @param device - The device configuration
 * @param options - Optional: userId, eventType, path (from webhook)
 */
const fetchAkuvoxFaceImage = async (device, options = {}) => {
    let baseUrl = device.ip.startsWith('http') ? device.ip : `http://${device.ip}`;
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

    const authHeaderBasic = "Basic " + Buffer.from(`${device.username}:${device.password}`).toString("base64");

    // Sanitize options to avoid matching against un-replaced device macros ($user_name, etc)
    if (options.name && options.name.startsWith('$')) options.name = null;
    if (options.userId && options.userId.startsWith('$')) options.userId = null;
    if (options.card && options.card.startsWith('$')) options.card = null;

    // console.log(`[Akuvox] Attempting to fetch face image from ${device.name} (ID: ${options.userId || 'any'}, Name: ${options.name || 'any'})`);

    const isValidImage = (buffer) => {
        if (!buffer || buffer.length < 100) return false;
        const header = buffer.slice(0, 4);
        if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) return true;
        if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) return true;
        return false;
    };

    const makeRequest = async (url, isJson = false, method = "GET", postBody = null) => {
        const path = new URL(url).pathname + new URL(url).search;
        try {
            const config = {
                method: method,
                url: url,
                headers: { 'Authorization': authHeaderBasic },
                responseType: isJson ? 'json' : 'arraybuffer',
                timeout: 5000 // Reduced from 25s to 5s to avoid blocking
            };
            if (postBody) {
                config.data = postBody;
                config.headers['Content-Type'] = 'application/json';
            }
            const response = await axios(config);
            return response.data;
        } catch (e) {
            if (e.response?.status === 401) {
                const wwwAuth = e.response.headers["www-authenticate"];
                if (wwwAuth && wwwAuth.includes("Digest")) {
                    try {
                        const getVal = (key) => {
                            const match = wwwAuth.match(new RegExp(`${key}="?([^",]+)"?`));
                            return match ? match[1] : null;
                        };
                        const realm = getVal("realm");
                        const nonce = getVal("nonce");
                        const qop = getVal("qop");
                        const opaque = getVal("opaque");
                        const ha1 = crypto.createHash("md5").update(`${device.username}:${realm}:${device.password}`).digest("hex");
                        const ha2 = crypto.createHash("md5").update(`${method}:${path}`).digest("hex");
                        const nc = "00000001";
                        const cnonce = crypto.randomBytes(8).toString("hex");
                        let responseStr = qop
                            ? crypto.createHash("md5").update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`).digest("hex")
                            : crypto.createHash("md5").update(`${ha1}:${nonce}:${ha2}`).digest("hex");

                        const authStr = `Digest username="${device.username}", realm="${realm}", nonce="${nonce}", uri="${path}", qop="${qop || ''}", nc=${nc}, cnonce="${cnonce}", response="${responseStr}", opaque="${opaque || ''}", algorithm="MD5"`;

                        const retryConfig = {
                            method: method,
                            url: url,
                            headers: { 'Authorization': authStr },
                            responseType: isJson ? 'json' : 'arraybuffer',
                            timeout: 8000 // Reduced from 25s to 8s
                        };
                        if (postBody) {
                            retryConfig.data = postBody;
                            retryConfig.headers['Content-Type'] = 'application/json';
                        }
                        const retryResponse = await axios(retryConfig);
                        return retryResponse.data;
                    } catch (digestError) {
                        console.error(`[Akuvox] Digest Auth Failed for ${url}:`, digestError.message);
                    }
                }
            }
            // console.warn(`[Akuvox] Request failed to ${url}: ${e.message}`);
            return null;
        }
    };

    // Strategy 0: Direct path from webhook
    if (options.path && options.path.length > 5 && options.path !== "undefined" && options.path !== "--") {
        console.log(`[Akuvox] Strategy 0: Trying direct path from webhook: ${options.path}`);
        const fullUrl = options.path.startsWith('http') ? options.path : `${baseUrl}${options.path.startsWith('/') ? '' : '/'}${options.path}`;
        const buffer = await makeRequest(fullUrl, false);
        if (isValidImage(buffer)) {
            console.log(`[Akuvox] ✓ Success: Image retrieved from direct path.`);
            return buffer;
        }
        console.warn(`[Akuvox] Strategy 0 failed: Path provided but no valid image found at ${fullUrl}`);
    }

    // Strategy 1: Log Polling (doorlog, searchlog)
    const logApis = ["doorlog", "searchlog", "accesslog"];
    const apiPorts = [null, "8080"];

    for (let retry = 0; retry < 2; retry++) { // Reduced from 6 retries to 2
        // console.log(`[Akuvox] Log Polling Attempt ${retry + 1}/6...`);

        for (const port of apiPorts) {
            let currentBaseUrl = baseUrl;
            if (port) {
                try {
                    const urlObj = new URL(baseUrl);
                    urlObj.port = port;
                    currentBaseUrl = urlObj.toString();
                    if (currentBaseUrl.endsWith('/')) currentBaseUrl = currentBaseUrl.slice(0, -1);
                } catch (e) { currentBaseUrl = `${baseUrl}:${port}`; }
            }

            for (const api of logApis) {
                try {
                    // Try both POST (Unified API) and GET (Legacy API)
                    let logData = await makeRequest(`${currentBaseUrl}/api/${api}/get`, true, "POST", {
                        "target": api, "action": "get", "data": { "num": 10 }
                    });

                    if (!logData || logData.retcode !== 0) {
                        logData = await makeRequest(`${currentBaseUrl}/api/${api}/get?num=10`, true);
                    }

                    if (logData?.retcode === 0 && logData.data?.item?.length > 0) {
                        console.log(`[Akuvox] ${api} poll (Port: ${port || '80'}) returned ${logData.data.item.length} items.`);

                        for (const entry of logData.data.item) {
                            const imageUrl = entry.PicUrl || entry.FaceUrl || entry.SnapUrl || entry.ImageUrl || entry.Pic;
                            if (imageUrl && !imageUrl.startsWith('$')) {
                                const entryUser = entry.UserID || entry.ID || entry.UserId;
                                const entryCard = entry.Card || entry.CardSn || entry.CardCode;
                                const entryName = entry.Name || entry.UserName;

                                const matchUser = options.userId && (String(entryUser) === String(options.userId));
                                const matchCard = options.card && (String(entryCard) === String(options.card));
                                const matchName = options.name && (String(entryName).toLowerCase() === String(options.name).toLowerCase());
                                const matchType = options.type && (String(entry.Type).toLowerCase() === String(options.type).toLowerCase()); // For call events

                                const isMatch = matchUser || matchCard || matchName || matchType;
                                const isLastResort = retry >= 4 && entryName !== "Unknown" && entryName !== "Desconocido";

                                if (isMatch || isLastResort) {
                                    const fullImageUrl = imageUrl.startsWith('http') ? imageUrl : `${currentBaseUrl}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
                                    console.log(`[Akuvox] Attempting download from: ${fullImageUrl} (Reason: ${isMatch ? 'Match' : 'Last Resort'})`);

                                    const buffer = await makeRequest(fullImageUrl, false);
                                    if (isValidImage(buffer)) {
                                        console.log(`[Akuvox] ✓ SUCCESS: Retrieved image from ${api}`);
                                        return buffer;
                                    }
                                }
                            }
                        }
                    }
                } catch (e) { /* silent fail for specific api/port combo */ }
            }
        }

        const waitTime = retry < 2 ? 1000 : 2000;
        await new Promise(r => setTimeout(r, waitTime));
    }

    // Strategy 3: User Profile
    if (options.userId) {
        const userData = await makeRequest(`${baseUrl}/api/user/get?UserID=${options.userId}`, true);
        const faceUrl = userData?.data?.item?.[0]?.FaceUrl;
        if (faceUrl) {
            const buffer = await makeRequest(faceUrl.startsWith('http') ? faceUrl : `${baseUrl}${faceUrl.startsWith('/') ? '' : '/'}${faceUrl}`, false);
            if (isValidImage(buffer)) return buffer;
        }
    }

    // Strategy 4: Direct Snapshot / MJPEG fallback
    console.log(`[Akuvox] Strategy 4: Intentando captura directa...`);
    return await fetchCameraSnapshot(device);
};

const debounceCache = new Map();
const DEBOUNCE_TIME = 5000;

// Global Alert State
let isAlertActive = false;
let globalLastAlertUpdateTime = 0;

// Global Guard Locations Map
const guardLocations = new Map();

// Global Active Missions (Incidents)
const activeMissions = new Map();

// Debug Logs History (In-memory)
const debugLogsHistory = [];
const MAX_DEBUG_LOGS = 500;

const addDebugLog = (data) => {
    const log = {
        id: data.id || `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        ...data
    };
    debugLogsHistory.unshift(log);
    if (debugLogsHistory.length > MAX_DEBUG_LOGS) {
        debugLogsHistory.pop();
    }
    if (global.io) {
        global.io.emit("webhook_debug", log);
    }
    return log;
};

const parseMultipart = (req) => {
    return new Promise((resolve, reject) => {
        const busboy = Busboy({ headers: req.headers });
        const result = { xmlContent: "", jsonContent: "", images: [] };
        const filePromises = [];

        busboy.on('file', (name, file, info) => {
            const { filename, encoding, mimeType } = info;
            console.log(`[Busboy] Part [${name}]: filename=${filename}, mimeType=${mimeType}`);

            const chunks = [];
            file.on('data', (chunk) => chunks.push(chunk));

            const p = new Promise((res, rej) => {
                file.on('end', () => {
                    const buffer = Buffer.concat(chunks);

                    // Priority 1: Check if it's an image
                    if (mimeType.includes("image") || name.toLowerCase().includes("pic") || name.toLowerCase().includes("image") || name.toLowerCase().includes("capture")) {
                        result.images.push({
                            buffer: buffer,
                            mimeType: mimeType || 'image/jpeg',
                            size: buffer.length,
                            name: name
                        });
                        console.log(`[Busboy] Image captured: ${name} (${buffer.length} bytes)`);
                    }
                    // Priority 2: Inspect content for JSON vs XML (More reliable than name)
                    else {
                        const text = buffer.toString('utf8').trim();
                        if (text.startsWith('{') || text.startsWith('[')) {
                            result.jsonContent = text;
                        } else if (text.startsWith('<')) {
                            result.xmlContent = text;
                        } else {
                            // Fallback based on name/mime if content inspection matches nothing
                            if (mimeType.includes("xml") || name.toLowerCase().includes("xml") || name.toLowerCase().includes("event")) {
                                result.xmlContent = text;
                            } else if (mimeType.includes("json") || name.toLowerCase().includes("json") || name.toLowerCase().includes("alarm")) {
                                result.jsonContent = text;
                            }
                        }
                    }
                    res();
                });
                file.on('error', rej);
            });
            filePromises.push(p);
        });

        busboy.on('field', (name, val) => {
            if (val.trim().startsWith("<")) {
                result.xmlContent = val;
            } else if (val.trim().startsWith("{") || val.trim().startsWith("[")) {
                result.jsonContent = val;
            }
        });

        busboy.on('finish', async () => {
            await Promise.all(filePromises);
            resolve(result);
        });

        busboy.on('error', reject);

        req.pipe(busboy);
    });
};

const handleWebhook = async (req, res, logPrefix) => {
    try {
        console.log(`${logPrefix} === Hikvision Webhook Received ===`);
        const contentType = req.headers['content-type'] || "";

        // Initial placeholder for debug data
        let debugData = {
            id: Date.now().toString(),
            timestamp: new Date(),
            source: 'hikvision',
            method: req.method,
            url: req.url,
            params: { contentType },
            credentialValue: null
        };

        let xmlContent = "";
        let jsonContent = "";
        let images = [];

        if (contentType.includes("multipart/form-data")) {
            const parsed = await parseMultipart(req);
            xmlContent = parsed.xmlContent;
            jsonContent = parsed.jsonContent;
            images = parsed.images;
            if (images.length > 0) console.log(`${logPrefix} [Hik] Multipart images found: ${images.length}`);
            if (jsonContent) console.log(`${logPrefix} [Hik] Multipart JSON metadata found.`);
        } else {
            const buffers = [];
            for await (const chunk of req) {
                buffers.push(chunk);
            }
            const rawBody = Buffer.concat(buffers).toString();
            if (rawBody.trim().startsWith("<")) {
                xmlContent = rawBody;
            } else if (rawBody.trim().startsWith("{")) {
                jsonContent = rawBody;
            }
        }

        if (!xmlContent && !jsonContent) {
            console.error(`${logPrefix} No XML or JSON metadata received`);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: "No XML/JSON metadata found" }));
            return;
        }

        // ==========================================
        // PATH A: JSON Content (Likely Face Event)
        // ==========================================
        // Check if it matches FACE event structure
        let jsonData = null;
        let isFaceEvent = false;
        if (jsonContent) {
            try {
                jsonData = JSON.parse(jsonContent);
                // Check if it contains Face Detection data
                const keys = Object.keys(jsonData);
                const hasFaceKeys = jsonData.alarmResult?.[0]?.faces || jsonData.faceMatchResult || jsonData.faces || jsonData.FaceInfo || jsonData.faceInfo;
                // Also check eventType
                const evtType = jsonData.eventType || jsonData.alarmResult?.eventType;

                if (hasFaceKeys || (evtType && evtType.toLowerCase().includes('face'))) {
                    isFaceEvent = true;
                } else {
                    console.log(`${logPrefix} [Hik] JSON metadata found but does not look like Face Event. Keys: ${keys.join(', ')}. Falling back to XML/LPR.`);
                }
            } catch (e) {
                console.error(`${logPrefix} [Hik] JSON parse error: ${e.message}. Falling back to XML/LPR.`);
            }
        }

        // ==========================================
        // PATH A: JSON Content (Likely Face Event)
        // ==========================================
        if (isFaceEvent && jsonData) {
            console.log(`${logPrefix} [DEBUG-JSON] Processing as FACE Event.`);

            // Normalización de Datos de Rostro
            const alarmData = jsonData.alarmResult?.[0] || jsonData.faceMatchResult || jsonData;
            const faceData = alarmData.faces?.[0] || alarmData.faceInfo || {};
            const identifyData = faceData.identify?.[0] || {};
            const candidate = identifyData.candidate?.[0] || {}; // Mejor coincidencia

            // Determinar Tipo de Evento
            const eventType = jsonData.eventType || alarmData.eventType || "faceCapture";
            // Lógica de Matching
            const isMatch = candidate.similarity && candidate.similarity > 70; // Hard threshold or just existence? 
            // The user said: "Solo debes almacenar los rostros que coinciden con la lista". 
            // Often un-matched faces have no candidate or very low similarity.
            // Hikvision usually sends 'blackList' or 'whiteList' type if matched.

            const personName = (candidate.reserve_field?.name || candidate.name || "").trim();
            const similarity = candidate.similarity ? Math.floor(candidate.similarity * 100) : 0;

            console.log(`${logPrefix} 👤 [FACE] Event: ${eventType}, Name: '${personName}', Sim: ${similarity}%`);

            // --- FILTER: Only Store Matches ---
            // Removed filter to allow capturing and displaying all faces including unknown subjects
            if (!personName || personName === "msg.unknown" || personName === "unknown" || personName === "") {
                console.log(`${logPrefix} 👤 [FACE] Unknown subject detected. Processing as INTRUSO.`);
            }

            // Debug Data Enrichment
            // debugData.credentialValue = personName;
            // debugData.status = 200;

            // --- Find Device ---
            const macAddress = jsonData.macAddress || alarmData.macAddress || jsonData.mac || null;
            const ipAddress = jsonData.ipAddress || alarmData.ipAddress || jsonData.ip || null;
            const eventTimestamp = jsonData.dateTime ? new Date(jsonData.dateTime) : new Date();

            const normalizeMac = (m) => m ? m.replace(/[:-\s]/g, "").toUpperCase() : null;
            let device = null;
            const cleanIncomingMac = normalizeMac(macAddress);

            if (cleanIncomingMac) {
                const allDevices = await prisma.device.findMany();
                device = allDevices.find(d => normalizeMac(d.mac) === cleanIncomingMac);
            }
            if (!device && ipAddress) {
                device = await prisma.device.findFirst({ where: { ip: ipAddress } });
            }

            if (!device) {
                device = await adoptDevice(macAddress, ipAddress || req.socket.remoteAddress, 'HIKVISION', 'FACE_TERMINAL');
            }

            // --- Process Images (Full vs Face) ---
            let fullImagePath = null;
            let faceImagePath = null;
            const eventId = generateId();

            if (images.length > 0) {
                // Improved Image Classification based on Field Name
                // Hikvision usually sends 'FaceImage' and 'BackgroundImage'
                let fullImg = images.find(img => img.name && (img.name.toLowerCase().includes('background') || img.name.toLowerCase().includes('scene') || img.name.toLowerCase().includes('full')));
                let faceImg = images.find(img => img.name && (img.name.toLowerCase().includes('face') || img.name.toLowerCase().includes('tracking') || img.name.toLowerCase().includes('capture') || img.name.toLowerCase().includes('snap')));

                // Fallback: Sort by size (Largest = Full, Smallest = Face)
                if (!fullImg || !faceImg) {
                    images.sort((a, b) => b.size - a.size);
                    if (!fullImg) fullImg = images[0];
                    if (!faceImg && images.length > 1) {
                        faceImg = images.find(img => img !== fullImg) || images[1];
                    }
                }

                try {
                    const devName = sanitizeName(device?.name);
                    const direction = (device?.direction === 'EXIT' ? 'salida' : 'entrada');
                    const fDate = formatEventDate(eventTimestamp);

                    // Upload Full (Using 'face' bucket for all face recognition events)
                    const fnameFull = `hik-face-${devName}-${direction}-${fDate}-${eventId}-full.jpg`;
                    fullImagePath = await uploadToS3(fullImg.buffer, fnameFull, fullImg.mimeType, "face");
                    console.log(`${logPrefix} [S3] Full image uploaded to face bucket: ${fullImagePath}`);

                    // Upload Face Crop (if exists)
                    if (faceImg) {
                        const fnameFace = `hik-face-${devName}-${direction}-${fDate}-${eventId}-crop.jpg`;
                        faceImagePath = await uploadToS3(faceImg.buffer, fnameFace, faceImg.mimeType, "face");
                        console.log(`${logPrefix} [S3] Face crop uploaded to face bucket: ${faceImagePath}`);
                    }
                } catch (imgError) {
                    console.error(`${logPrefix} [S3] Upload FAILED: ${imgError.message}`);
                }
            }

            // --- Find User (if matched) ---
            let credentialId = null;
            let userId = null;
            // let user = null; // Defined in prisma block below

            // Try to find the user in our DB by name
            const user = await prisma.user.findFirst({ where: { name: personName } });
            if (user) {
                userId = user.id;
                // Find or create a FACE credential placeholder if needed
                const cred = await prisma.credential.findFirst({ where: { userId: user.id, type: 'FACE' } });
                if (cred) credentialId = cred.id;
            }

            // --- Check System Mode for Face ---
            const modeSetting = await prisma.setting.findUnique({ where: { key: 'MODE_FACE' } });
            const mode = modeSetting?.value || 'WHITELIST'; // Default to Whitelist

            let finalDecision = "GRANT";
            if (mode === 'BLACKLIST') {
                finalDecision = "DENY";
                console.log(`${logPrefix} ⛔ [MODE-FACE] BLACKLIST Active - Identified user DENIED.`);
            } else {
                console.log(`${logPrefix} ✅ [MODE-FACE] WHITELIST Active - Identified user GRANTED.`);
            }

            // --- Create Event ---
            const event = await prisma.accessEvent.create({
                data: {
                    id: eventId,
                    deviceId: device ? device.id : null,
                    credentialId,
                    userId,
                    timestamp: eventTimestamp,
                    accessType: 'FACE',
                    direction: device?.direction || "ENTRY",
                    decision: finalDecision, // Dynamic Decision
                    snapshotPath: faceImagePath || fullImagePath, // Store FACE crop as main snapshot if available
                    imagePath: fullImagePath || faceImagePath, // Store FULL scene as context
                    plateDetected: null,
                    plateNumber: null,
                    // Store extra details including Face Crop Path
                    details: `Modo: Rostro, Persona: ${personName || "Desconocido"}, CamMatch: ${similarity}% (Local: ${mode})`
                }
            });

            // --- Notify UI ---
            if (global.io) {
                global.io.emit("access_event", {
                    ...event,
                    device,
                    user: user || { name: personName },
                    direction: event.direction,
                    brand: 'HIKVISION',
                    userName: personName || user?.name || "Desconocido"
                });
                // Emit webhook event for topology animation
                global.io.emit("webhook-event", {
                    type: "FACE",
                    device: device?.name || "Unknown",
                    timestamp: new Date().toISOString()
                });
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: "processed", type: "FACE", decision: finalDecision }));
            return;
        }

        // ==========================================
        // PATH B: XML Content (LPR / ANPR)
        // ==========================================

        // Parse XML
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_"
        });
        const xmlData = parser.parse(xmlContent);

        // DEBUG: Log the keys of the parsed XML to see the structure
        console.log(`${logPrefix} [DEBUG-XML] Root keys: ${Object.keys(xmlData).join(', ')}`);

        // Extract Data
        let eventAlert = xmlData.EventNotificationAlert || xmlData;

        // If it's a nested structure like { EventNotificationAlert: { ... } }
        if (xmlData.EventNotificationAlert) {
            eventAlert = xmlData.EventNotificationAlert;
        }

        const macAddress = xmlData.macAddress || eventAlert.macAddress || eventAlert.ANPR?.macAddress || eventAlert['@_macAddress'];
        const ipAddress = xmlData.ipAddress || eventAlert.ipAddress || eventAlert.ANPR?.ipAddress || eventAlert['@_ipAddress'];

        const plateNumber = xmlData.ANPR?.licensePlate ||
            eventAlert.ANPR?.licensePlate ||
            xmlData.licensePlate ||
            eventAlert.licensePlate ||
            xmlData.EventNotificationAlert?.ANPR?.licensePlate;

        // --- HANDLE HIKVISION NON-EVENT MESSAGES (Heartbeats / Tests / Stun) ---
        const eventType = xmlData.eventType || eventAlert.eventType || "";
        const isHeartbeat = eventType.toLowerCase().includes('heartbeat') ||
            xmlContent.toLowerCase().includes('heartbeat') ||
            xmlContent.toLowerCase().includes('stun');

        // Check for ANPR Data presence to determine if it's a vehicle event despite missing plate
        const hasAnprData = xmlData.ANPR || eventAlert.ANPR || xmlData.EventNotificationAlert?.ANPR || eventAlert.vehicleInfo;

        if (!plateNumber && !hasAnprData) {
            if (isHeartbeat) {
                // UPDATE: Track push connection for heartbeats too
                const cleanIncomingMac = macAddress ? macAddress.replace(/[:-\s]/g, "").toUpperCase() : null;
                if (cleanIncomingMac || ipAddress) {
                    await prisma.device.updateMany({
                        where: {
                            OR: [
                                { mac: { contains: cleanIncomingMac } },
                                { ip: ipAddress }
                            ]
                        },
                        data: { lastOnlinePush: new Date() }
                    }).catch(e => console.error(`${logPrefix} Error updating heartbeat: ${e.message}`));
                }

                // Return silently for heartbeats - no log spam, no socket emission
                res.writeHead(200);
                res.end(JSON.stringify({ status: "ok", type: "heartbeat" }));
                return;
            }

            // If it's a known non-plate message, we don't log or emit debug to avoid spam
            // addDebugLog({ ...debugData, status: 200, credentialValue: "NON-ANPR" });

            console.warn(`${logPrefix} ℹ️ Webhook received without plate (possible test or non-ANPR event)`);
            res.writeHead(200);
            res.end(JSON.stringify({ status: "ok", message: "Ignored: No plate found" }));
            return;
        }

        // Enrich debug data with the plate

        // Extraer Metadatos Adicionales (Color, Tipo, Marca, Decisión de Cámara)
        // Hikvision guarda la info del vehículo en el objeto vehicleInfo
        const vehicleInfo = xmlData.ANPR?.vehicleInfo || eventAlert.ANPR?.vehicleInfo || {};

        // Extraer color - Hikvision envía AMBOS: código numérico Y texto
        const colorCode = vehicleInfo.colorDepth ||
            vehicleInfo.vehicleColor ||
            xmlData.ANPR?.vehicleColor ||
            eventAlert.ANPR?.vehicleColor;

        const colorText = vehicleInfo.color ||
            xmlData.ANPR?.color ||
            eventAlert.ANPR?.color;

        const brandCode = vehicleInfo.vehicleLogoRecog ||
            vehicleInfo.vehicleLogo ||
            vehicleInfo.vehicleBrand ||
            vehicleInfo.brand ||
            xmlData.ANPR?.vehicleLogo ||
            eventAlert.ANPR?.vehicleLogo ||
            xmlData.ANPR?.vehicleBrand ||
            eventAlert.ANPR?.vehicleBrand;

        // Mapeo de colores en inglés a español
        const COLOR_TEXT_MAP = {
            'white': 'Blanco',
            'silver': 'Plateado',
            'gray': 'Gris',
            'grey': 'Gris',
            'black': 'Negro',
            'red': 'Rojo',
            'blue': 'Azul',
            'darkblue': 'Azul Oscuro',
            'yellow': 'Amarillo',
            'green': 'Verde',
            'brown': 'Marrón',
            'pink': 'Rosa',
            'purple': 'Púrpura',
            'cyan': 'Cian',
            'orange': 'Naranja'
        };

        // Priorizar el texto directo sobre el código numérico
        let vehicleColor = "Unknown";
        if (colorText && COLOR_TEXT_MAP[colorText.toLowerCase()]) {
            vehicleColor = COLOR_TEXT_MAP[colorText.toLowerCase()];
        } else if (colorCode) {
            vehicleColor = getVehicleColorName(colorCode);
        }

        const vehicleBrand = brandCode ? getVehicleBrandName(brandCode) : "Unknown";

        const vehicleType = xmlData.ANPR?.vehicleType || eventAlert.ANPR?.vehicleType || "Unknown";

        const vehicleModel = vehicleInfo.vehicleModel ||
            vehicleInfo.vehileModel || // Typo en la API de Hikvision
            vehicleInfo.model ||
            xmlData.ANPR?.vehicleModel ||
            eventAlert.ANPR?.vehicleModel ||
            "Unknown";

        // Guardar TODOS los datos ANPR para futuras implementaciones
        const rawAnprData = {
            ...eventAlert.ANPR,
            vehicleInfo: vehicleInfo,
            codes: {
                colorCode,
                colorText,
                brandCode
            }
        };

        // DEBUG: Log all ANPR fields to identify correct field names
        console.log(`${logPrefix} 🔍 [DEBUG-ANPR] Extracted values:`, {
            color: vehicleColor,
            type: vehicleType,
            brand: vehicleBrand,
            model: vehicleModel
        });

        // Match Info desde la cámara (Si la cámara ya decidió)
        // Estructura usual: eventAlert.ANPR.originalLicensePlate o matches...
        // A veces viene en <ListName> o <ListType> dentro de matchInfo
        // Buscamos en varios lugares posibles según firmware

        let cameraDecision = null;

        // Método 1: Buscar en matches/matchInfo
        const matchList = eventAlert.ANPR?.matches || eventAlert.matches || eventAlert.ANPR?.matchInfo || eventAlert.matchInfo;
        if (matchList) {
            // Puede ser un array o un objeto único
            const matchInfo = Array.isArray(matchList) ? matchList[0] : matchList;
            console.log(`${logPrefix} 🔍 [MATCH-INFO] matchInfo:`, matchInfo);

            if (matchInfo) {
                // Verificar diferentes variantes de campo
                const listType = matchInfo.listType || matchInfo.ListType || matchInfo.type;
                const listName = matchInfo.listName || matchInfo.ListName || matchInfo.name;

                console.log(`${logPrefix} 🔍 [MATCH-INFO] listType: ${listType}, listName: ${listName}`);

                if (listType === 'whiteList' || listType === 'WhiteList' || listName === 'whiteList' || listName === 'WhiteList') {
                    cameraDecision = "GRANT";
                    console.log(`${logPrefix} ✅ [WHITELIST] Detected from camera - GRANT`);
                } else if (listType === 'blackList' || listType === 'BlackList' || listName === 'blackList' || listName === 'BlackList') {
                    cameraDecision = "DENY";
                    console.log(`${logPrefix} ❌ [BLACKLIST] Detected from camera - DENY`);
                }
            }
        }

        // Método 2: Buscar directamente en ANPR
        if (!cameraDecision) {
            const anprListType = eventAlert.ANPR?.listType || eventAlert.ANPR?.ListType;
            const anprListName = eventAlert.ANPR?.listName || eventAlert.ANPR?.ListName;
            const vehicleListName = eventAlert.ANPR?.vehicleListName; // Campo específico de Hikvision

            if (anprListType || anprListName || vehicleListName) {
                console.log(`${logPrefix} 🔍 [ANPR-LIST] listType: ${anprListType}, listName: ${anprListName}, vehicleListName: ${vehicleListName}`);

                // Verificar vehicleListName primero (más específico)
                if (vehicleListName) {
                    const listNameLower = vehicleListName.toLowerCase();
                    if (listNameLower.includes('white') || listNameLower.includes('allow') || listNameLower.includes('blanca') || listNameLower.includes('permitida')) {
                        cameraDecision = "GRANT";
                        console.log(`${logPrefix} ✅ [WHITELIST] Detected from vehicleListName: ${vehicleListName} - GRANT`);
                    } else if (listNameLower.includes('black') || listNameLower.includes('block') || listNameLower.includes('negra') || listNameLower.includes('bloqueada')) {
                        cameraDecision = "DENY";
                        console.log(`${logPrefix} ❌ [BLACKLIST] Detected from vehicleListName: ${vehicleListName} - DENY`);
                    } else if (listNameLower.includes('other')) {
                        console.log(`${logPrefix} ℹ️ [OTHER-LIST] Plate on 'otherList' (Common for unknown plates) - Will check DB`);
                    }
                }

                // Si no se detectó por vehicleListName, verificar otros campos
                if (!cameraDecision && (anprListType === 'whiteList' || anprListType === 'WhiteList' || anprListName === 'whiteList' || anprListName === 'WhiteList')) {
                    cameraDecision = "GRANT";
                    console.log(`${logPrefix} ✅ [WHITELIST] Detected from ANPR - GRANT`);
                } else if (!cameraDecision && (anprListType === 'blackList' || anprListType === 'BlackList' || anprListName === 'blackList' || anprListName === 'BlackList')) {
                    cameraDecision = "DENY";
                    console.log(`${logPrefix} ❌ [BLACKLIST] Detected from ANPR - DENY`);
                }
            }
        }

        if (!cameraDecision) {
            console.log(`${logPrefix} ⚠️ [NO-CAMERA-DECISION] Camera did not send whitelist/blacklist info`);
            console.log(`${logPrefix} ⚠️ [NO-CAMERA-DECISION] Event will be marked as UNKNOWN - manual review required`);
        }

        const cleanPlate = (plateNumber || "").toString().toUpperCase().replace(/[^A-Z0-9]/g, "");
        const isUnknown = cleanPlate === "UNKNOWN" || cleanPlate === "";
        const finalPlate = isUnknown ? "NO_LEIDA" : cleanPlate;

        // Enrich debug data with the plate
        debugData.credentialValue = finalPlate;

        // Timestamp
        let eventTimestamp = new Date();
        const cameraDateTime = xmlData.dateTime || eventAlert.dateTime;
        if (cameraDateTime) {
            try {
                eventTimestamp = new Date(cameraDateTime);
            } catch (e) {
                eventTimestamp = new Date();
            }
        }

        // Debounce
        const now = Date.now();
        const lastSeen = debounceCache.get(finalPlate);
        if (lastSeen && now - lastSeen < DEBOUNCE_TIME) {
            console.log(`${logPrefix} Debounced: ${finalPlate}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: "Debounced", plate: finalPlate }));
            return;
        }
        debounceCache.set(finalPlate, now);

        // Helper to normalize MAC (removes colons, dashes, and makes uppercase)
        const normalizeMac = (m) => m ? m.replace(/[:-\s]/g, "").toUpperCase() : m;

        // Find Device - Strategic lookup (MOVED UP)
        let device = null;
        const cleanIncomingMac = normalizeMac(macAddress);

        if (cleanIncomingMac) {
            const allDevices = await prisma.device.findMany();
            device = allDevices.find(d => normalizeMac(d.mac) === cleanIncomingMac);
        }

        if (!device && ipAddress) {
            device = await prisma.device.findFirst({ where: { ip: ipAddress } });
        }

        if (!device) {
            // Last resort: find any Hikvision device if we only have one
            const hikDevices = await prisma.device.findMany({ where: { brand: 'HIKVISION' } });
            if (hikDevices.length === 1) {
                device = hikDevices[0];
                console.log(`${logPrefix} [RECOVERY] Auto-matched to the only available Hikvision device: ${device.name}`);
            }
        }

        if (!device) {
            device = await adoptDevice(macAddress, ipAddress || req.socket.remoteAddress, 'HIKVISION', 'LPR_CAMERA');
        }

        // UPDATE: Track push connection for actual events
        if (device) {
            await prisma.device.update({
                where: { id: device.id },
                data: { lastOnlinePush: new Date() }
            }).catch(e => { });
        }

        // Save Image to S3 (MinIO)
        let relativeImagePath = null;
        const eventId = generateId();

        // Sort images by size to pick the largest (Full Scene) instead of the crop
        if (images.length > 1) {
            images.sort((a, b) => b.size - a.size);
        }
        const imageFile = images.length > 0 ? images[0] : null;

        if (imageFile) {
            try {
                const devName = sanitizeName(device?.name);
                const direction = (device?.direction === 'EXIT' ? 'salida' : 'entrada');
                const fDate = formatEventDate(eventTimestamp);

                const filename = `hik-lpr-${devName}-${direction}-${fDate}-${eventId}.jpg`;
                console.log(`${logPrefix} [S3] Attempting upload of ${imageFile.size} bytes: ${filename}`);
                relativeImagePath = await uploadToS3(imageFile.buffer, filename, imageFile.mimeType || "image/jpeg", "lpr");
                console.log(`${logPrefix} [S3] Upload SUCCESS: ${relativeImagePath}`);
            } catch (imgError) {
                console.error(`${logPrefix} [S3] Upload FAILED: ${imgError.message}`);
            }
        } else {
            console.warn(`${logPrefix} [S3] Skip upload: No image part in webhook. Images length: ${images.length}`);
        }

        // Finalize debug emission for ACTUAL events
        // addDebugLog({
        //     ...debugData,
        //     status: 200,
        //     deviceName: device?.name,
        //     deviceMac: macAddress || device?.mac
        // });

        // Create Event Logic
        // ACCESS LOGIC: Prioritize Camera Decision (allowList/whiteList)
        // Fallback to local DB if camera doesn't provide decision
        let accessDecision = cameraDecision;
        let credentialId = null;
        let userId = null;

        // Search for plate in local database to enrich event and as fallback
        console.log(`${logPrefix} 🔍 [DB-SEARCH] Searching for plate: "${finalPlate}" (type: PLATE)`);
        const credential = !isUnknown ? await prisma.credential.findFirst({
            where: {
                type: 'PLATE',
                value: finalPlate
            },
            include: { user: true }
        }) : null;

        if (credential) {
            const user = credential.user;
            credentialId = credential.id;
            userId = user.id;

            // --- Check System Mode for LPR ---
            const modeSetting = await prisma.setting.findUnique({ where: { key: 'MODE_LPR' } });
            const mode = modeSetting?.value || 'WHITELIST';

            if (mode === 'BLACKLIST') {
                accessDecision = "DENY";
                console.log(`${logPrefix} ⛔ [MODE-LPR] BLACKLIST Active - Plate found in DB -> DENIED.`);
            } else {
                if (!accessDecision) {
                    accessDecision = "GRANT";
                    console.log(`${logPrefix} ✅ [MODE-LPR] WHITELIST Active - Plate found in DB -> GRANTED.`);
                }
            }
        } else {
            if (!accessDecision) {
                accessDecision = "DENY";
                console.log(`${logPrefix} ❌ [DB-DECISION] Camera silent, Plate NOT found in DB - DENY`);
            } else {
                console.log(`${logPrefix} ℹ️ [DB-INFO] Plate NOT found in DB, but using Camera Decision: ${accessDecision}`);
            }
        }

        console.log(`${logPrefix} [DEBUG] Generated eventId: ${eventId}`);

        // Persist Event
        const event = await prisma.accessEvent.create({
            data: {
                id: eventId,
                deviceId: device ? device.id : null,
                credentialId,
                userId,
                timestamp: eventTimestamp,
                accessType: 'PLATE',
                direction: device?.direction || "ENTRY",
                decision: accessDecision || "DENY", // If still null after DB check, default to DENY
                snapshotPath: relativeImagePath,
                plateNumber: finalPlate,
                plateDetected: finalPlate, // Ensure we fill both
                details: `${isUnknown ? 'ALERTA: Matrícula No Reconocida. ' : ''}Marca: ${vehicleBrand}, Modelo: ${vehicleModel}, Color: ${vehicleColor}, Tipo: ${vehicleType}, Source: ${cameraDecision ? 'Camera' : 'Server'}`
            }
        });

        console.log(`${logPrefix} Event created: ${event.id} (${accessDecision}) - Plate: ${finalPlate}`);

        // Notify UI
        if (global.io) {
            console.log(`${logPrefix} [SOCKET] Emitting access_event for plate: ${cleanPlate}`);
            global.io.emit("access_event", {
                ...event,
                device,
                user: credential ? credential.user : null,
                direction: event.direction // Ensure direction is explicitly sent
            });
            // Emit webhook event for topology animation
            global.io.emit("webhook-event", {
                type: "LPR",
                device: device?.name || "Unknown",
                plate: cleanPlate,
                timestamp: new Date().toISOString()
            });
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: "processed", decision: accessDecision }));

    } catch (error) {
        console.error(`${logPrefix} Webhook Error:`, error);
        res.writeHead(500);
        res.end(JSON.stringify({ error: "Internal Server Error" }));
    }
}

const handleAvicamWebhook = async (req, res, logPrefix) => {
    try {
        console.log(`${logPrefix} === Avicam Webhook Received ===`);
        let body = {};
        if (req.method === 'POST') {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const data = Buffer.concat(chunks).toString();
            try {
                body = JSON.parse(data);
            } catch (e) {
                console.warn(`${logPrefix} Avicam body is not JSON`);
            }
        }

        const macAddress = body.info?.DeviceID || body.mac || body.SN || body.SerialNumber;
        const eventType = body.operator || 'FACE_DETECTION';
        console.log(`${logPrefix} [Avicam] Processing Triggered: op='${body.operator}' (len:${body.operator?.length}) mac='${macAddress}'`);
        
        const allDevices = await prisma.device.findMany({ where: { brand: 'AVICAM' } });
        const normalizeMac = (m) => (m ? String(m).replace(/[:-\s]/g, "").toUpperCase() : null);
        const cleanIncomingMac = normalizeMac(macAddress);
        let device = allDevices.find(d => normalizeMac(d.mac) === cleanIncomingMac);

        console.log(`${logPrefix} [Avicam] Device search for '${cleanIncomingMac}' -> ${device ? device.name : 'NOT FOUND'}`);
        if (!device) {
            console.log(`${logPrefix} [Avicam] Available AVICAM MACs:`, allDevices.map(d => normalizeMac(d.mac)));
        }

        if (!device) {
            const remoteIp = req.socket.remoteAddress;
            const cleanRemoteIp = remoteIp ? remoteIp.replace(/^.*:/, '') : null;
            if (cleanRemoteIp) {
                device = allDevices.find(d => d.ip === cleanRemoteIp || d.ip.includes(cleanRemoteIp));
                if (device) console.log(`${logPrefix} [Avicam] Device matched by IP: ${device.name}`);
            }
        }

        if (!device) {
            device = await adoptDevice(macAddress, req.socket.remoteAddress, 'AVICAM', 'FACE_TERMINAL');
        }

        if (device) {
            await prisma.device.update({
                where: { id: device.id },
                data: { lastOnlinePush: new Date() }
            }).catch(() => { });
        }

        // --- NEW: Process Events and Create History ---
        if (body.operator === 'VerifyPush' || body.operator === 'FacePicPush') {
            console.log(`${logPrefix} [Avicam] Entering VerifyPush block...`);
            const info = body.info || {};
            const personName = info.Name || body.data?.Name || 'Desconocido';
            const personId = info.PersonID || body.data?.PersonId;
            console.log(`${logPrefix} [Avicam] Event details - Person: ${personName}, ID: ${personId}`);
            
            // Extract image (can be direct string or inside array)
            let imagePath = null;
            let rawImage = null;
            
            if (typeof body.SanpPic === 'string' && body.SanpPic.length > 100) {
                rawImage = body.SanpPic;
            } else if (Array.isArray(body.SanpPic) && body.SanpPic.length > 0) {
                rawImage = body.SanpPic[0].szPicData || body.SanpPic[0].szPicData1;
            } else if (body.data?.SanpPic) {
                rawImage = typeof body.data.SanpPic === 'string' ? body.data.SanpPic : body.data.SanpPic[0]?.szPicData;
            }

            if (rawImage && typeof rawImage === 'string') {
                try {
                    // Limpiar prefijo data:image si existe
                    const cleanBase64 = rawImage.replace(/^data:image\/\w+;base64,/, "");
                    const buffer = Buffer.from(cleanBase64, 'base64');
                    console.log(`${logPrefix} [Avicam] Decoded image size: ${buffer.length} bytes. Raw time: ${info.CreateTime}`);
                    
                    const filename = `av-${device?.id || 'unknown'}-${Date.now()}.jpg`;
                    
                    // Wrap upload in a timeout to prevent hanging the whole request
                    const uploadPromise = uploadToS3(buffer, filename, "image/jpeg", 'face');
                    const timeoutPromise = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('S3 Upload Timeout')), 5000)
                    );
                    
                    imagePath = await Promise.race([uploadPromise, timeoutPromise]);
                    console.log(`${logPrefix} [Avicam] Image uploaded: ${imagePath}`);
                } catch (imgErr) {
                    console.error(`${logPrefix} [Avicam] Image upload failed or timed out:`, imgErr.message);
                }
            }

            // Clean body for DB (remove huge image)
            const bodyForDb = { ...body };
            if (bodyForDb.SanpPic) bodyForDb.SanpPic = "[STRIPIED_IMAGE_DATA]";
            if (bodyForDb.data?.SanpPic) bodyForDb.data.SanpPic = "[STRIPIED_IMAGE_DATA]";

            // Try to find user in DB
            let userId = null;
            if (personName && personName !== 'Desconocido') {
                try {
                    const user = await prisma.user.findFirst({
                        where: {
                            OR: [
                                { name: { contains: personName, mode: 'insensitive' } },
                                { credentials: { some: { value: String(personId) } } }
                            ]
                        }
                    });
                    if (user) userId = user.id;
                } catch (userErr) {
                    console.error(`${logPrefix} [Avicam] User search error:`, userErr.message);
                }
            }

            // Format details as a Key:Value string for the UI to parse easily
            const detailsStr = `Modo: Rostro, Rostro: ${personName}, ID: ${personId}, Sim: ${info.Similarity1 || body.data?.Similarity || 0}%`;

            // Create AccessEvent record
            let eventData = null;
            try {
                // Timezone Correction: Avicam sends local time (UTC-3). Convert to UTC for server.
                let eventTime = info.CreateTime ? new Date(info.CreateTime) : new Date();
                if (info.CreateTime && !info.CreateTime.includes('Z') && !info.CreateTime.includes('+')) {
                    // It's a local string. Add 3 hours to match UTC server.
                    eventTime = new Date(eventTime.getTime() + (3 * 60 * 60 * 1000));
                }

                eventData = {
                    timestamp: eventTime,
                    accessType: 'FACE',
                    deviceId: device?.id || null,
                    userId: userId || null,
                    direction: device?.direction || 'ENTRY',
                    location: device?.location || 'Terminal Avicam',
                    decision: info.VerifyStatus === 1 ? 'GRANT' : 'DENY',
                    details: detailsStr,
                    imagePath: imagePath,
                    snapshotPath: imagePath
                };
                
                console.log(`${logPrefix} [Avicam] PRE-DB: Creating event with ts=${eventData.timestamp.toISOString()} deviceId=${eventData.deviceId}`);
                const event = await prisma.accessEvent.create({ data: eventData });
                console.log(`${logPrefix} [Avicam] DB SUCCESS: id=${event.id} timestamp=${event.timestamp.toISOString()}`);
                
                // Emit event for real-time dashboards (Underscore for UI compatibility)
                if (global.io) {
                    // Enrich for UI components that expect joined relations
                    const enrichedEvent = {
                        ...event,
                        device: device,
                        user: {
                            name: personName,
                            cara: imagePath,
                            unit: null
                        },
                        deviceName: device?.name,
                        userName: personName,
                        brand: 'AVICAM'
                    };
                    global.io.emit("access_event", enrichedEvent);
                }
            } catch (dbErr) {
                console.error(`${logPrefix} [Avicam] DB ERROR!!!!`);
                console.error(`${logPrefix} [Avicam] Stack:`, dbErr.stack);
                console.error(`${logPrefix} [Avicam] Code:`, dbErr.code);
                console.log(`${logPrefix} [Avicam] Data attempted for ${personName}:`, JSON.stringify(eventData, null, 2));
            }
        }

        addDebugLog({
            id: Date.now().toString(),
            timestamp: new Date(),
            source: 'avicam',
            method: req.method,
            url: req.url,
            params: body,
            deviceName: device?.name || 'Avicam Desconocido',
            deviceMac: macAddress,
            credentialValue: body.info?.Name || body.name || body.personName || eventType
        });

        if (global.io) {
            global.io.emit("webhook-event", {
                type: "AVICAM",
                vendor: "AVICAM",
                device: device?.name || "Avicam Device",
                eventType: eventType,
                timestamp: new Date().toISOString()
            });
        }

        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
    } catch (error) {
        console.error(`${logPrefix} Avicam Handler Error:`, error);
        res.writeHead(500);
        res.end("Error");
    }
};

const handleAkuvoxWebhook = async (req, res, logPrefix) => {
    try {
        console.log(`${logPrefix} === Akuvox Webhook Received ===`);
        const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
        const params = Object.fromEntries(parsedUrl.searchParams);
        const eventId = generateId();

        console.log(`${logPrefix} Akuvox Params:`, params);

        // Required params based on our spec
        let eventType = params.event;
        const macAddress = params.mac;
        const cardNumber = params.card;

        // Normalización de eventos según recomendación en docs/akuvox/AKUVOX_CALLBACKS.md
        // Soporta eventos directos (event=door_open) o anidados (event=relay&status=open)
        if (eventType === 'relay' || eventType === 'relay_open' || eventType === 'relay_close') {
            const isOpening = eventType === 'relay_open' || (eventType === 'relay' && params.status === 'open');
            eventType = isOpening ? 'door_open' : 'door_close';
        } else if (eventType === 'card') {
            eventType = params.type === 'invalid' ? 'card_invalid' : 'card_valid';
        } else if (eventType === 'face') {
            eventType = params.type === 'invalid' ? 'face_invalid' : 'face_valid';
        } else if (eventType === 'code') {
            eventType = params.type === 'invalid' ? 'code_invalid' : 'code_valid';
        } else if (eventType === 'qr' || eventType === 'qr_valid' || eventType === 'qr_invalid') {
            const isInvalid = eventType === 'qr_invalid' || params.type === 'invalid' || params.unlocktype === 'Null';
            eventType = isInvalid ? 'qr_invalid' : 'qr_valid';
        } else if (eventType === 'call_start') {
            eventType = 'calling';
        } else if (eventType === 'call_end' || eventType === 'hangup') {
            eventType = 'call_end';
        } else if (eventType === 'boot' || eventType === 'setup_completed') {
            eventType = 'boot';
        }

        // Eventos de sistema (si vienen por el parámetro event directamente)
        // Ejemplos: tamper, calling, login_fail, motion

        if (!macAddress) {
            console.warn(`${logPrefix} Akuvox webhook missing MAC`);
            res.writeHead(400);
            res.end("Missing MAC");
            return;
        } else {
            const allDevices = await prisma.device.findMany({ where: { brand: 'AKUVOX' } });
            const normalizeMac = (m) => m ? m.replace(/[:-\s]/g, "").toUpperCase() : null;
            const cleanIncomingMac = normalizeMac(macAddress);
            const device = allDevices.find(d => normalizeMac(d.mac) === cleanIncomingMac);
            if (device) {
                await prisma.device.update({
                    where: { id: device.id },
                    data: { lastOnlinePush: new Date() }
                }).catch(e => { });
            }
        }

        // Helper to normalize MAC (moved here for broader scope if needed, but also defined above)
        const normalizeMac = (m) => m ? m.replace(/[:-\s]/g, "").toUpperCase() : null;
        const cleanMac = normalizeMac(macAddress);

        // Find Device
        const allDevices = await prisma.device.findMany();
        let device = allDevices.find(d => normalizeMac(d.mac) === cleanMac);

        // Emit debug event for monitoring (after finding device)
        addDebugLog({
            id: Date.now().toString(),
            timestamp: new Date(),
            source: 'akuvox',
            method: req.method,
            url: req.url,
            params: params,
            deviceName: device?.name || 'Dispositivo Desconocido',
            deviceMac: macAddress,
            credentialValue: params.card || params.user || params.name || params.code || eventType
        });

        if (!device) {
            // RECOVERY: If MAC is invalid (macro literal like $mac) or not found, try by IP
            const remoteIp = req.socket.remoteAddress;
            const cleanRemoteIp = remoteIp ? remoteIp.replace(/^.*:/, '') : null;

            console.log(`${logPrefix} [RECOVERY] MAC not matched ($mac or unknown). Attempting IP match for: ${cleanRemoteIp}`);

            if (cleanRemoteIp) {
                device = allDevices.find(d => d.ip === cleanRemoteIp || d.ip.includes(cleanRemoteIp));
            }

            if (!device && allDevices.length === 1 && allDevices[0].brand === 'AKUVOX') {
                device = allDevices[0];
                console.log(`${logPrefix} [RECOVERY] Only one Akuvox device in DB. Auto-matching...`);
            }
        }

        if (!device) {
            device = await adoptDevice(macAddress, req.socket.remoteAddress, 'AKUVOX', 'DOOR_INTERCOM');
        }

        if (!device) {
            console.warn(`${logPrefix} Unknown Akuvox Device. MAC: ${macAddress}, IP: ${req.socket.remoteAddress}`);
        }

        let accessDecision = "DENY";
        let credentialType = null;
        let credentialValue = null;
        let userId = null;
        let user = null;
        let details = "";
        let snapPath = null; // Defined here for all logic types

        // Process Event Type
        if (eventType === 'door_open') {
            // Door opened remotely or manually
            console.log(`${logPrefix} Door Open Event from ${macAddress}`);
            details = `Puerta Abierta (${params.id || 'Relay A'})`;
            accessDecision = "GRANT";
            credentialType = "TAG";
            credentialValue = "DOOR_OPEN";

            if (device) {
                try {
                    await prisma.device.update({
                        where: { id: device.id },
                        data: { doorStatus: 'OPEN' }
                    });

                    // ATOMIC CAPTURE ON REMOTE OPEN
                    console.log(`${logPrefix} [AUTO-SNAP] Triggering Akuvox face image fetch for DOOR_OPEN event...`);
                    const snapBuffer = await fetchAkuvoxFaceImage(device, { name: params.user || params.name });
                    if (snapBuffer) {
                        try {
                            const devName = sanitizeName(device?.name);
                            const direction = (device?.direction === 'EXIT' ? 'salida' : 'entrada');
                            const fDate = formatEventDate(new Date());
                            const filename = `aku-open-${devName}-${direction}-${fDate}-${eventId}.jpg`;
                            snapPath = await uploadToS3(snapBuffer, filename, "image/jpeg", "face");
                            details += " (Evidencia capturada)";
                        } catch (e) {
                            console.error("Error uploading open snapshot to S3:", e.message);
                        }
                    }

                } catch (e) { console.error("Error updating door status:", e); }
            }

            if (global.io) {
                global.io.emit("device_status", {
                    deviceId: device?.id,
                    mac: macAddress,
                    doorStatus: 'open',
                    timestamp: new Date()
                });
            }

        } else if (eventType === 'door_close') {
            console.log(`${logPrefix} Door Close Event from ${macAddress}`);
            details = `Puerta Cerrada`;
            accessDecision = "GRANT";
            credentialType = 'TAG';
            credentialValue = 'DOOR_CLOSE';

            if (device) {
                try {
                    await prisma.device.update({
                        where: { id: device.id },
                        data: { doorStatus: 'CLOSED' }
                    });
                } catch (e) { console.error("Error updating door status:", e); }
            }

            if (global.io) {
                global.io.emit("device_status", {
                    deviceId: device?.id,
                    mac: macAddress,
                    doorStatus: 'closed',
                    timestamp: new Date()
                });
            }

        } else if (eventType === 'card_valid') {
            credentialType = 'TAG';
            credentialValue = cardNumber;
            accessDecision = "GRANT";
            details = `Tarjeta RFID Válida: ${cardNumber}`;

            if (device) {
                console.log(`${logPrefix} [AUTO-SNAP] Triggering Akuvox face image fetch for card event...`);
                const snapBuffer = await fetchAkuvoxFaceImage(device, { userId: params.userid, card: cardNumber, name: params.user || params.name });
                if (snapBuffer) {
                    try {
                        const devName = sanitizeName(device?.name);
                        const direction = (device?.direction === 'EXIT' ? 'salida' : 'entrada');
                        const fDate = formatEventDate(new Date());
                        const filename = `aku-card-${devName}-${direction}-${fDate}-${eventId}.jpg`;
                        snapPath = await uploadToS3(snapBuffer, filename, "image/jpeg", "face");
                        details += " (Evidencia capturada)";
                    } catch (e) {
                        console.error("Error uploading card snapshot to S3:", e.message);
                    }
                }
            }

        } else if (eventType === 'card_invalid') {
            credentialType = 'TAG';
            credentialValue = cardNumber;
            accessDecision = "DENY";
            details = `Tarjeta RFID Inválida: ${cardNumber}`;

        } else if (eventType === 'face_valid' || eventType === 'face_invalid') {
            const isSuccess = eventType === 'face_valid';
            credentialType = 'FACE';

            // Filter out device macros that weren't replaced ($name, $user, etc)
            const rawValue = params.user || params.name || (isSuccess ? "Unknown" : "Desconocido");
            credentialValue = rawValue.startsWith('$') ? "No Identificado" : rawValue;

            // Default access decision (will be overridden by MODE_FACE logic if user found)
            accessDecision = isSuccess ? "GRANT" : "DENY";
            details = isSuccess ? `Rostro: ${credentialValue}, Similitud: ${params.similarity || '100'}%` : `Rostro: Desconocido, Similitud: 0%`;

            // ATOMIC CAPTURE ON FACE EVENT
            if (device) {
                console.log(`${logPrefix} [AUTO-SNAP] Triggering Akuvox face image fetch for face event...`);
                console.log(`${logPrefix} [AUTO-SNAP] Params: FaceUrl=${params.FaceUrl}, PicUrl=${params.PicUrl}, userid=${params.userid}`);

                // Priority: FaceUrl from hook (if provided), then userId lookup
                const snapBuffer = await fetchAkuvoxFaceImage(device, {
                    userId: params.userid,
                    name: params.user || params.name,
                    path: params.FaceUrl || params.PicUrl,
                    card: params.card
                });
                if (snapBuffer) {
                    try {
                        const devName = sanitizeName(device?.name);
                        const direction = (device?.direction === 'EXIT' ? 'salida' : 'entrada');
                        const fDate = formatEventDate(new Date());
                        const filename = `aku-face-${devName}-${direction}-${fDate}-${eventId}.jpg`;
                        snapPath = await uploadToS3(snapBuffer, filename, "image/jpeg", "face");

                        // Enrich details for the UI modal (EventDetailsDialog expects FaceImage: <path>)
                        if (details.includes('Rostro:')) {
                            details += `, FaceImage: ${snapPath}`;
                        } else {
                            details += ` - FaceImage: ${snapPath}`;
                        }

                        console.log(`${logPrefix} [AUTO-SNAP] ✓ Face image uploaded to S3: ${snapPath}`);
                    } catch (e) {
                        console.error("Error uploading face snapshot to S3:", e.message);
                    }
                }
                else {
                    console.warn(`${logPrefix} [AUTO-SNAP] ✗ Failed to fetch face image from device`);
                }
            }

        } else if (eventType === 'code_valid') {
            credentialType = 'PIN';
            credentialValue = params.code;
            accessDecision = "GRANT";
            details = `Código PIN Válido: ${params.code}`;

            if (device) {
                console.log(`${logPrefix} [AUTO-SNAP] Triggering Akuvox face image fetch for pin event...`);
                const snapBuffer = await fetchAkuvoxFaceImage(device, { userId: params.userid, name: params.user || params.name });
                if (snapBuffer) {
                    try {
                        const devName = sanitizeName(device?.name);
                        const direction = (device?.direction === 'EXIT' ? 'salida' : 'entrada');
                        const fDate = formatEventDate(new Date());
                        const filename = `aku-pin-${devName}-${direction}-${fDate}-${eventId}.jpg`;
                        snapPath = await uploadToS3(snapBuffer, filename, "image/jpeg", "face");
                        details += " (Evidencia capturada)";
                    } catch (e) {
                        console.error("Error uploading pin snapshot to S3:", e.message);
                    }
                }
            }

        } else if (eventType === 'code_invalid') {
            credentialType = 'PIN';
            credentialValue = params.code || "XXXX";
            accessDecision = "DENY";
            details = `Código PIN Inválido: ${credentialValue}`;

        } else if (eventType === 'tamper') {
            details = `¡ALERTA!: Sensor Tamper activado (Sabotaje detectado)`;
            accessDecision = "DENY";
            credentialType = 'TAG';
            credentialValue = 'ALARM_TAMPER';

        } else if (eventType === 'calling' || eventType === 'invite' || eventType === 'call_created') {
            details = `Llamada entrante a: ${params.to || 'Central'}`;
            accessDecision = "GRANT";
            credentialType = 'TAG';
            credentialValue = 'CALL_START';

            // ATOMIC CAPTURE ON CALL
            if (device) {
                console.log(`${logPrefix} [AUTO-SNAP] Triggering Akuvox face image fetch for call event...`);
                // For calls, we only have doorlog strategy since there's no userId yet
                const snapBuffer = await fetchAkuvoxFaceImage(device, { name: params.user || params.name, type: 'intercom' });
                if (snapBuffer) {
                    try {
                        const devName = sanitizeName(device?.name);
                        const direction = (device?.direction === 'EXIT' ? 'salida' : 'entrada');
                        const fDate = formatEventDate(new Date());
                        const filename = `aku-call-${devName}-${direction}-${fDate}-${eventId}.jpg`;
                        snapPath = await uploadToS3(snapBuffer, filename, "image/jpeg", "face");
                        details += " (Foto S3 capturada)";
                    } catch (e) {
                        console.error("Error uploading call snapshot to S3:", e.message);
                    }
                }
            }

            if (global.io) {
                global.io.emit("device_call", { mac: macAddress, to: params.to, timestamp: new Date(), snapshot: snapPath });
            }

        } else if (eventType === 'qr_valid') {
            credentialType = 'TAG';
            credentialValue = params.qrcode || "QR_CODE";
            accessDecision = "GRANT";
            details = `Código QR Válido: ${credentialValue}`;

            if (device) {
                const snapBuffer = await fetchAkuvoxFaceImage(device, { userId: params.userid, name: params.user || params.name });
                if (snapBuffer) {
                    try {
                        const devName = sanitizeName(device?.name);
                        const direction = (device?.direction === 'EXIT' ? 'salida' : 'entrada');
                        const fDate = formatEventDate(new Date());
                        const filename = `aku-qr-${devName}-${direction}-${fDate}-${eventId}.jpg`;
                        snapPath = await uploadToS3(snapBuffer, filename, "image/jpeg", "face");
                        details += " (Foto S3 capturada)";
                    } catch (e) { }
                }
            }

        } else if (eventType === 'qr_invalid') {
            credentialType = 'TAG';
            credentialValue = params.qrcode || "QR_INVALID";
            accessDecision = "DENY";
            details = `Código QR Inválido detectado`;

        } else if (eventType === 'input_open' || eventType === 'input_close') {
            const sensor = params.input || "Default";
            details = `Sensor ${sensor}: ${eventType === 'input_open' ? 'ACTIVADO' : 'CERRADO'}`;
            accessDecision = "GRANT";
            credentialType = 'TAG';
            credentialValue = `INPUT_${sensor}`;

        } else if (eventType === 'call_end') {
            details = `Llamada finalizada (Hang Up)`;
            accessDecision = "GRANT";
            credentialType = 'TAG';
            credentialValue = 'CALL_END';

        } else if (eventType === 'boot') {
            details = `Dispositivo Reiniciado (Boot) - FW: ${params.firmware || 'N/A'}, Modelo: ${params.model || 'N/A'}`;
            accessDecision = "GRANT";
            credentialType = 'TAG';
            credentialValue = 'SYSTEM_BOOT';

        } else {
            console.warn(`${logPrefix} Unknown Akuvox event: ${eventType}`);
            details = `Evento Desconocido: ${eventType}`;
            accessDecision = "DENY";
        }

        // Try to find user by credential or userid
        if (params.userid) {
            // First try by person external ID (numeric ID in Akuvox should match user.id in some setups, or be mapped)
            // In our system, Akuvox ID = numeric translation of user.id
            const potentialUser = await prisma.user.findFirst({
                where: {
                    OR: [
                        { id: params.userid }, // Direct match if ID is numeric
                        { id: { endsWith: params.userid.padStart(4, '0') } } // Fallback for padded IDs
                    ]
                }
            });
            if (potentialUser) {
                user = potentialUser;
                userId = user.id;
                details += ` - User: ${user.name} (Match ID)`;
                console.log(`${logPrefix} ✓ User found by ID: ${user.name} (${user.id})`);
            }
        }

        if (!user && credentialValue && credentialType) {
            console.log(`${logPrefix} 🔍 [DB-SEARCH] Searching for credential: "${credentialValue}" (type: ${credentialType})`);
            const credential = await prisma.credential.findFirst({
                where: {
                    value: credentialValue,
                    type: credentialType
                },
                include: { user: true }
            });

            if (credential) {
                user = credential.user;
                userId = user.id;
                details += ` - User: ${user.name}`;
                console.log(`${logPrefix} ✓ User found by ${credentialType} credential: ${user.name} (${user.id})`);

                // --- Apply FACE Mode Logic (similar to LPR) ---
                if (credentialType === 'FACE') {
                    const modeSetting = await prisma.setting.findUnique({ where: { key: 'MODE_FACE' } });
                    const mode = modeSetting?.value || 'WHITELIST';
                    details += `, Modo: ${mode}`;

                    if (mode === 'BLACKLIST') {
                        accessDecision = "DENY";
                        console.log(`${logPrefix} ⛔ [MODE-FACE] BLACKLIST Active - Face found in DB -> DENIED.`);
                    } else if (mode === 'WHITELIST') {
                        accessDecision = "GRANT";
                        console.log(`${logPrefix} ✅ [MODE-FACE] WHITELIST Active - Face found in DB -> GRANTED.`);
                    }
                }
            } else {
                console.log(`${logPrefix} ✗ No user found for ${credentialType} credential: ${credentialValue}`);

                // If FACE event and user NOT found in DB, check MODE to decide
                if (credentialType === 'FACE' && eventType === 'face_valid') {
                    const modeSetting = await prisma.setting.findUnique({ where: { key: 'MODE_FACE' } });
                    const mode = modeSetting?.value || 'WHITELIST';
                    details += `, Modo: ${mode}`;

                    if (mode === 'BLACKLIST') {
                        // In BLACKLIST mode, unknown faces should be GRANTED (not in blacklist)
                        accessDecision = "GRANT";
                        console.log(`${logPrefix} ✅ [MODE-FACE] BLACKLIST Active - Unknown face -> GRANTED (not blacklisted).`);
                    } else {
                        // In WHITELIST mode, unknown faces should be DENIED (not in whitelist)
                        accessDecision = "DENY";
                        console.log(`${logPrefix} ❌ [MODE-FACE] WHITELIST Active - Unknown face -> DENIED (not whitelisted).`);
                    }
                }
            }
        }

        // Persist Access Event
        if (device) {
            const event = await prisma.accessEvent.create({
                data: {
                    id: eventId,
                    deviceId: device.id,
                    timestamp: new Date(),
                    accessType: credentialType || (eventType.includes('face') ? 'FACE' : 'TAG'),
                    direction: device.direction || "ENTRY",
                    decision: accessDecision,
                    userId: userId,
                    details: details,
                    plateDetected: credentialValue, // Use this for ID/Tag display if no plate
                    plateNumber: null,
                    snapshotPath: snapPath || null
                }
            });

            // Notify UI via WebSocket
            if (global.io) {
                console.log(`${logPrefix} [SOCKET] Emitting access_event for Akuvox event: ${eventType}`);
                global.io.emit("access_event", {
                    ...event,
                    device,
                    user: user || { name: credentialValue },
                    direction: event.direction,
                    brand: 'AKUVOX',
                    userName: credentialValue || user?.name || "Desconocido"
                });
                // Emit webhook event for topology animation
                global.io.emit("webhook-event", {
                    type: "AKUVOX",
                    device: device?.name || "Unknown",
                    eventType: eventType,
                    timestamp: new Date().toISOString()
                });
            }

            console.log(`${logPrefix} Akuvox Event Logged: ${event.id} - ${eventType} - ${accessDecision}`);
        } else {
            console.warn(`${logPrefix} Event skipped - Device not found in DB (MAC: ${macAddress})`);
        }

        res.writeHead(200);
        res.end("OK");

    } catch (error) {
        console.error(`${logPrefix} Akuvox Handler Error:`, error);
        res.writeHead(500);
        res.end("Error");
    }
};

const requestHandler = async (req, res) => {
    if (req.url.includes("/socket.io/")) return;
    const logPrefix = `[${new Date().toISOString()}]`;
    const remoteIp = req.socket.remoteAddress;
    // --- LOG POST/PUT REQUESTS (For Webhook Debugging) ---
    if (req.method === 'POST' || req.method === 'PUT') {
        console.log(`${logPrefix} 📥 [${req.method}] ${req.url} from ${remoteIp}`);
    }

    // Health check
    if (req.url === '/health' || req.url === '/ping') {
        res.writeHead(200);
        res.end('OK');
        return;
    }

    // Test Socket
    if (req.url === '/api/test-socket') {
        console.log(`${logPrefix} 🧪 Manual Socket Test Triggered`);
        if (global.io) {
            global.io.emit("access_event", {
                id: "test-" + Date.now(),
                accessType: "FACE",
                userName: "Test Manual",
                brand: "AVICAM",
                timestamp: new Date(),
                device: { name: "Cámara Test" }
            });
            res.writeHead(200);
            res.end("Emitted");
        } else {
            res.writeHead(500);
            res.end("global.io not defined");
        }
        return;
    }

    // Socket.IO requests should be handled by the engine attached to httpServer.
    // If they fall through here, we'll log it in the 404 handler at the end.


    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // --- ROUTING LOGIC (SOPORTE ULTRA-PERMISIVO) ---
    const url = req.url.toLowerCase();

    // AKUVOX FACE IMAGE PROXY (From Doorlog)
    if (url.includes('/api/proxy/face')) {
        const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
        const deviceId = query.get('deviceId');
        const date = query.get('date');
        const time = query.get('time');

        if (!deviceId || !date || !time) {
            res.writeHead(400);
            res.end("Missing parameters (deviceId, date, time)");
            return;
        }

        const device = await prisma.device.findUnique({ where: { id: deviceId } });
        if (!device) {
            res.writeHead(404);
            res.end("Device not found");
            return;
        }

        // STRID SPECIFICATIONS IMPLEMENTATION (V13)
        // Rule of Gold: Stripping leading zeros from time components
        const hms = time.split(':');
        const cleanTime = hms.map(t => parseInt(t, 10)).join('-'); // 08:05:07 -> 8-5-7
        const leadZeroTime = hms.join('-');

        const fileNameVariations = [
            `${date}_${cleanTime}_0.jpg`,   // NEW: Working example suffix _0
            `${date}_${cleanTime}.jpg`,     // Rule of Gold
            `${date}_${leadZeroTime}_0.jpg`,
            `${date}_${leadZeroTime}.jpg`
        ];

        const folders = ['DoorPicture', 'IntercomPicture'];
        const protocols = ['https', 'http'];

        const pureIp = device.ip.replace(/^https?:\/\//, '').split(':')[0];

        for (const protocol of protocols) {
            const currentBaseUrl = `${protocol}://${pureIp}`;

            for (const folder of folders) {
                for (const fileName of fileNameVariations) {
                    const finalUrl = `${currentBaseUrl}/Image/${folder}/${fileName}`;
                    const relativePath = `/Image/${folder}/${fileName}`;

                    console.log(`${logPrefix} [Proxy-Face-V13] 🔍 Testing -> ${finalUrl}`);

                    try {
                        let imageRes;
                        try {
                            // Try WITHOUT forced Basic first (often fixes Digest issues or works with No-Auth)
                            imageRes = await axios.get(finalUrl, {
                                responseType: 'arraybuffer',
                                timeout: 5000,
                                headers: { 'Connection': 'close' },
                                validateStatus: (status) => status === 200,
                                maxRedirects: 10,
                                httpsAgent: agent
                            });
                        } catch (e) {
                            if (e.response?.status === 401) {
                                console.log(`${logPrefix} [Proxy-Face] 🔐 Negotiating Auth for ${fileName}`);
                                const buffer = await tryFetchWithDigest(finalUrl, relativePath, device);
                                if (buffer) {
                                    console.log(`${logPrefix} [Proxy-Face] ✅ Success via Auth!`);
                                    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
                                    res.end(buffer);
                                    return;
                                }
                            }
                            throw e;
                        }

                        if (imageRes && imageRes.status === 200 && isValidImage(imageRes.data, imageRes.headers['content-type'])) {
                            console.log(`${logPrefix} [Proxy-Face] ✅ Found! (${folder}/${fileName})`);
                            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
                            res.end(imageRes.data);
                            return;
                        }
                    } catch (error) {
                        const status = error.response?.status;
                        if (status !== 404) {
                            console.warn(`${logPrefix} [Proxy-Face] ✗ Error: ${error.code || status} at ${fileName}`);
                        }
                    }
                }
            }
        }

        console.error(`${logPrefix} [Proxy-Face] 🚫 Not found for ${device.name} using strict spec after trying Door & Intercom.`);
        res.end("Image not found");
        return;
    }

    // DISPOSITIVO IMAGE PROXY (Generic for Doorlogs/Memory)
    if (url.includes('/api/proxy/device-image')) {
        const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
        const deviceId = query.get('deviceId');
        const pathParam = query.get('path');

        if (!deviceId || !pathParam) {
            res.writeHead(400);
            res.end("Missing parameters (deviceId, path)");
            return;
        }

        const device = await prisma.device.findUnique({ where: { id: deviceId } });
        if (!device) {
            res.writeHead(404);
            res.end("Device not found");
            return;
        }

        // Handle synthetic path from AkuvoxDriver (PROXY_FACE|date|time)
        if (pathParam.startsWith('PROXY_FACE|')) {
            const [, date, time] = pathParam.split('|');
            const hms = time.split(':');
            const cleanTime = hms.map(t => parseInt(t, 10)).join('-');
            const leadZeroTime = hms.join('-');
            const compactTime = hms.join('');
            const compactDate = date.replace(/-/g, '');

            const fileNameVariations = [
                `${date}_${cleanTime}_0.jpg`,
                `${date}_${cleanTime}.jpg`,
                `${date}_${leadZeroTime}_0.jpg`,
                `${date}_${leadZeroTime}.jpg`,
                `${compactDate}_${compactTime}_0.jpg`,
                `${compactDate}_${compactTime}.jpg`,
                `${compactDate}${compactTime}.jpg`
            ];

            const folders = ['DoorPicture', 'IntercomPicture', 'CapPicture', 'Snapshot'];
            const pureIp = device.ip.replace(/^https?:\/\//, '').split(':')[0];
            const ports = [null, '8080'];

            for (const port of ports) {
                const currentIp = port ? `${pureIp}:${port}` : pureIp;

                for (const folder of folders) {
                    for (const fileName of fileNameVariations) {
                        const finalUrl = `http://${currentIp}/Image/${folder}/${fileName}`;
                        const relativePath = `/Image/${folder}/${fileName}`;

                        // console.log(`${logPrefix} [Proxy-Device-Image] 🔍 Testing synthetic -> ${finalUrl}`);
                        try {
                            let imageRes = await axios.get(finalUrl, {
                                responseType: 'arraybuffer',
                                timeout: 3500, // Shorter timeout to try many variations quickly
                                validateStatus: (status) => status === 200,
                                httpsAgent: agent
                            }).catch(async (e) => {
                                if (e.response?.status === 401) {
                                    return { data: await tryFetchWithDigest(finalUrl, relativePath, device), status: 200 };
                                }
                                return null;
                            });

                            const buffer = imageRes?.data;
                            if (buffer && isValidImage(buffer)) {
                                console.log(`${logPrefix} [Proxy-Device-Image] ✅ Success! (${folder}/${fileName}) Port: ${port || '80'}`);
                                res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
                                res.end(buffer);
                                return;
                            }
                        } catch (e) { /* continue */ }
                    }
                }
            }
        } else {
            // Direct path proxy
            const pureIp = device.ip.replace(/^https?:\/\//, '').split(':')[0];
            const finalUrl = pathParam.startsWith('http') ? pathParam : `http://${pureIp}${pathParam.startsWith('/') ? '' : '/'}${pathParam}`;

            try {
                let imageRes = await axios.get(finalUrl, {
                    responseType: 'arraybuffer',
                    timeout: 10000,
                    validateStatus: (status) => status === 200,
                    httpsAgent: agent
                }).catch(async (e) => {
                    if (e.response?.status === 401) {
                        return { data: await tryFetchWithDigest(finalUrl, pathParam, device), status: 200 };
                    }
                    return null;
                });

                const buffer = imageRes?.data;
                if (buffer && isValidImage(buffer)) {
                    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
                    res.end(buffer);
                    return;
                }
            } catch (e) {
                console.error(`${logPrefix} [Proxy-Device-Image] Direct path failed: ${finalUrl}`);
            }
        }

        res.writeHead(404);
        res.end("Not found");
        return;
    }

    // LIVE PROXY (Para ver cámaras remotas en el navegador)
    if (url.includes('/api/live/')) {
        console.log(`${logPrefix} 🎯 Match: LIVE Proxy (Path: ${req.url})`);
        // Extraer el ID limpiamente (sin query params ni slashes extras)
        const parts = req.url.split('/');
        const rawId = parts[parts.length - 1] || parts[parts.length - 2];
        const deviceId = rawId.split('?')[0];

        const device = await prisma.device.findUnique({ where: { id: deviceId } });
        if (!device) {
            console.error(`${logPrefix} [LIVE] Device not found for ID: ${deviceId}`);
            res.writeHead(404);
            res.end("Device not found");
            return;
        }

        const clientIp = req.socket.remoteAddress;
        console.log(`${logPrefix} [LIVE] Proxying for ${device.name} (${device.ip}) - Client: ${clientIp}`);

        // UPDATE STATUS: Marking device as online because we are connecting to it
        await prisma.device.update({
            where: { id: device.id },
            data: { lastOnlinePush: new Date() }
        }).catch(() => { });

        // STRATEGY 1: Direct MJPEG Pipe (Linux/Dahua/Hikvision Efficient Stream)
        if (device.brand === 'AKUVOX' || device.brand === 'DAHUA' || device.brand === 'HIKVISION') {
            const success = await proxyVideoStream(device, res, req);
            if (success) return;
        }

        // STRATEGY 2: Snapshot Polling Fallback (Works with Digest/Android/Slow devices)
        console.log(`${logPrefix} [LIVE] Falling back to Snapshot Polling Strategy for ${device.name}`);
        res.writeHead(200, {
            'Content-Type': 'multipart/x-mixed-replace; boundary=--frame',
            'Cache-Control': 'no-cache',
            'Connection': 'close',
            'Pragma': 'no-cache'
        });

        const sendFrames = async () => {
            while (true) {
                // EXTREME SAFETY CAUSE: Check if socket is still alive BEFORE each fetch
                if (req.socket.destroyed || req.socket.writableEnded) {
                    console.log(`${logPrefix} [LIVE] Client disconnected. Stopping stream for ${device.name}.`);
                    break;
                }

                const buffer = await fetchCameraSnapshot(device);

                // Re-check after long-running fetch
                if (req.socket.destroyed || req.socket.writableEnded) break;

                if (buffer) {
                    try {
                        res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${buffer.length}\r\n\r\n`);
                        res.write(buffer);
                        res.write('\r\n');
                    } catch (e) {
                        console.log(`${logPrefix} [LIVE] Write failed (client closed).`);
                        break;
                    }
                }
                const pollInterval = (device.brand === 'AKUVOX') ? 300 : 500;
                await new Promise(r => setTimeout(r, pollInterval));
            }
        };
        sendFrames();
        return;
    }

    // HIKVISION (LPR) fallback or explicit path
    // Many cameras send to root '/' if not configured with a path
    if (url.includes('hikvision') || (url === '/' && req.method === 'POST')) {
        console.log(`${logPrefix} 🎯 Match: HIKVISION Driver (Path: ${req.url})`);
        await handleWebhook(req, res, logPrefix);
        return;
    }

    // AKUVOX (FACE/TAG/DOOR)
    // Detection: Explicit path OR Characteristic parameters (mac + event/card)
    const isAkuvoxParams = (req.url.includes('mac=') && (req.url.includes('event=') || req.url.includes('card=') || req.url.includes('user=')));
    if (url.includes('akuvox') || isAkuvoxParams) {
        console.log(`${logPrefix} 🎯 Match: AKUVOX Driver (Path: ${req.url})`);
        await handleAkuvoxWebhook(req, res, logPrefix);
        return;
    }

    // AVICAM (FACE TERMINAL) - Usamos matches específicos para evitar colisión con archivos
    if (url.includes('/webhooks/avicam') || url.includes('/subscribe/heartbeat')) {
        console.log(`${logPrefix} 🎯 Match: AVICAM Driver (Path: ${req.url})`);
        await handleAvicamWebhook(req, res, logPrefix);
        return;
    }

    // WAHA (WhatsApp Chatbot)
    // We make this more permissive as various environments might strip or add slashes
    if (url.includes('waha') || url.includes('whatsapp')) {
        console.log(`${logPrefix} 💬 Match: WAHA WhatsApp Webhook (Path: ${req.url})`);
        await handleWahaWebhook(req, res, logPrefix, prisma);
        return;
    }

    // OTROS (Solo log para identificar qué llega)
    if (url.includes('webhook') || url.includes('event')) {
        console.warn(`${logPrefix} ❓ Webhook detectado pero no coincide con marca específica: ${req.url}`);
    }

    console.log(`${logPrefix} ⚠️  404 Not Found: ${req.method} ${req.url}. URL processed: ${url}`);
    res.writeHead(404);
    res.end();
};

const httpServer = http.createServer((req, res) => {
    if (req.url.startsWith('/socket.io/')) return;
    requestHandler(req, res);
});

// NOTA: Unificamos Socket.IO en el mismo puerto 10000
const io = new Server(httpServer, {
    path: "/socket.io",
    maxHttpBufferSize: 1e8, // 100MB for handling images if needed
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

io.on("connection", (socket) => {
    console.log(`Socket client connected: ${socket.id}`);

    socket.on("ping_test", (data) => {
        console.log(`[SOCKET-DEBUG] Ping received: ${data}`);
        socket.emit("pong_test", "pong-" + data);
        io.emit("broadcast_test", "broadcast-" + data);
    });

    // Send history to new connection
    if (debugLogsHistory.length > 0) {
        console.log(`Sending ${debugLogsHistory.length} debug logs to client ${socket.id}`);
        socket.emit("webhook_history", debugLogsHistory);
    }

    // Send initial alert status
    socket.emit("alert_status", { active: isAlertActive });

    // Send current guard locations immediately
    if (guardLocations.size > 0) {
        socket.emit("guard_locations", Array.from(guardLocations.values()));
    }

    // Send active missions immediately
    if (activeMissions.size > 0) {
        socket.emit("active_missions", Array.from(activeMissions.values()));
    }

    // Register guard tablet presence and broadcast to admin
    socket.on("guard_presence", (data) => {
        // Prioritize the IP reported by the client if it exists (local IP detection)
        const socketIp = (socket.handshake.headers['x-forwarded-for'] || socket.handshake.address).replace('::ffff:', '');

        io.emit("guard_presence", {
            ...data,
            socketId: socket.id,
            ip: data.reportedIp || socketIp
        });
    });

    // --- GPS TRACKING ---
    socket.on("guard_location_update", (data) => {
        // data: { lat, lng, accuracy, guardName, timestamp }
        guardLocations.set(socket.id, { ...data, socketId: socket.id });
        io.emit("guard_locations", Array.from(guardLocations.values()));
    });

    // --- BACKUP REQUESTS (SOLICITUD DE APOYO) ---
    socket.on("request_backup", async (data) => {
        // data: { type: 'INDIVIDUO' | 'VEHICULO', lat, lng, requesterName, details }
        console.log(`[BACKUP] Request from ${data.requesterName}: ${data.type}`);

        let bitacoraId = null;
        try {
            const entry = await prisma.bitacora.create({
                data: {
                    type: "ALERTA",
                    plate: "SOS",
                    name: (data.type || "SOLICITUD APOYO").toUpperCase(),
                    notes: `Solicitud iniciada por ${data.requesterName}. Detalles: ${data.details || 'Sin detalles'}`,
                    guardName: data.requesterName,
                    latitude: data.lat,
                    longitude: data.lng,
                    timestamp: new Date()
                }
            });
            bitacoraId = entry.id;
        } catch (e) {
            console.error("Error logging backup request:", e);
        }

        const mission = {
            id: data.id || 'req-' + Date.now(),
            bitacoraId: bitacoraId,
            ...data,
            requesterId: socket.id,
            timestamp: Date.now(),
            status: 'PENDING'
        };

        activeMissions.set(mission.id, mission);

        // Broadcast to all
        io.emit("backup_requested", mission);

        // Also notify admin consoles
        socket.broadcast.emit("admin_alert", {
            type: "BACKUP_REQUEST",
            message: `Solicitud de apoyo: ${data.type} por ${data.requesterName}`,
            location: { lat: data.lat, lng: data.lng }
        });

        // NOTIFICACIÓN WHATSAPP
        try {
            const waNumber = await prisma.setting.findUnique({ where: { key: "WAHA_NOTIFICATION_NUMBER" } });
            if (waNumber && waNumber.value) {
                const message = `🚨 *SOLICITUD DE APOYO* 🚨\n\n*Tipo:* ${data.type}\n*Guardia:* ${data.requesterName}\n*Detalles:* ${data.details || 'Sin detalles'}\n*Ubicación:* https://www.google.com/maps?q=${data.lat},${data.lng}\n\n_OmniAccess Seguridad_`;
                await sendWahaText(prisma, waNumber.value, message);
            }
        } catch (err) {
            console.error("[WAHA] Error notifying backup request:", err);
        }


        // Broadcast Push Notification
        sendPushToAll({
            title: "⚠️ SOLICITUD DE APOYO",
            body: `${data.type} reportado por ${data.requesterName}.`,
            icon: "/iconos/sildan-pwa.png",
            tag: "mission-alert",
            vibrate: [200, 100, 200, 100, 200],
            data: { url: '/guard', missionId: mission.id } // Opens /guard (tablet version defaults)
        });
    });

    socket.on("respond_backup", (data) => {
        // data: { requestId, accepted: true/false, responderName }
        console.log(`[BACKUP] Response from ${data.responderName}: ${data.accepted ? 'ACCEPTED' : 'REJECTED'}`);

        const mission = activeMissions.get(data.requestId);
        if (mission) {
            mission.status = data.accepted ? 'ACCEPTED' : 'PENDING';
            mission.responderName = data.responderName;
            mission.responderId = socket.id;
            activeMissions.set(data.requestId, mission);
        }

        // Notify everyone Update status
        io.emit("backup_status_update", {
            ...data,
            responderId: socket.id
        });
    });

    socket.on("resolve_backup", async (data) => {
        // data: { requestId, bitacoraId, outcome: 'FALSA_ALARMA' | 'SOLUCIONADO', notes, guardName }
        console.log(`[BACKUP] Resolved by ${data.guardName}: ${data.outcome}`);

        try {
            if (data.bitacoraId) {
                // Update existing record
                await prisma.bitacora.update({
                    where: { id: data.bitacoraId },
                    data: {
                        notes: `[RESUELTO: ${data.outcome}] ${data.notes || ''}`
                    }
                });
            } else {
                // Fallback: Create new if no ID provided
                await prisma.bitacora.create({
                    data: {
                        type: "ALERTA",
                        plate: "SOS",
                        name: "RESOLUCIÓN",
                        notes: `Incidente resuelto (${data.outcome}). Detalles: ${data.notes || ''}`,
                        guardName: data.guardName,
                        timestamp: new Date()
                    }
                });
            }
        } catch (e) {
            console.error("Error resolving backup in DB:", e);
        }

        activeMissions.delete(data.requestId);

        io.emit("backup_resolved", {
            requestId: data.requestId,
            outcome: data.outcome,
            resolverName: data.guardName
        });
    });

    socket.on("cancel_backup", (data) => {
        console.log(`[BACKUP] Cancelled by ${data.guardName}`);
        activeMissions.delete(data.requestId);
        io.emit("backup_cancelled", {
            requestId: data.requestId,
            cancelledBy: data.guardName
        });
    });

    socket.on("disconnect", () => {
        if (guardLocations.has(socket.id)) {
            guardLocations.delete(socket.id);
            io.emit("guard_locations", Array.from(guardLocations.values()));
        }
        console.log(`Socket client disconnected: ${socket.id}`);
    });

    socket.on("new_bitacora", (data) => {
        io.emit("new_bitacora", data);
    });

    socket.on("alert_toggle", async (data) => {
        const now = Date.now();
        if (now - globalLastAlertUpdateTime < 3000) {
            console.warn(`[ALERT] Global alert toggle throttled. Source: ${socket.id}, TriggeredBy: ${data.triggeredBy}`);
            return;
        }

        const previousState = isAlertActive;
        isAlertActive = !!data.active;

        // If state didn't change, return (prevents notification flood)
        if (previousState === isAlertActive) {
            console.log(`[ALERT] Alert toggle ignored (no change). Source: ${socket.id}`);
            return;
        }

        globalLastAlertUpdateTime = now;

        console.log(`[ALERT] Alert mode set to: ${isAlertActive} by ${data.triggeredBy || socket.id}`);

        // Log to database for permanent record
        try {
            const loc = guardLocations.get(socket.id);
            const notes = isAlertActive
                ? `[BOTÓN DE PÁNICO] Activado por ${data.triggeredBy || 'Guardia'}.`
                : `[SISTEMA NORMALIZADO] Desactivado por ${data.triggeredBy || 'Guardia'}. ${data.explanation ? `Motivo: ${data.explanation}` : ''}`;

            await prisma.bitacora.create({
                data: {
                    type: "ALERTA",
                    plate: isAlertActive ? "PÁNICO" : "Manual",
                    name: (data.triggeredBy || "GUARDIA").toUpperCase(),
                    notes: notes,
                    guardName: data.triggeredBy || "Invitado",
                    latitude: loc ? loc.lat : null,
                    longitude: loc ? loc.lng : null,
                    timestamp: new Date()
                }
            });
        } catch (e) {
            console.error("Error logging alert status change:", e);
        }

        io.emit("alert_status", {
            active: isAlertActive,
            triggeredBy: data.triggeredBy,
            explanation: data.explanation || ""
        });

        // SEND PUSH
        const pushPayload = isAlertActive ? {
            title: "⚠️ ALERTA DE SEGURIDAD",
            body: `Modo de alerta activado por ${data.triggeredBy || "un compañero"}.`,
            icon: "/iconos/sildan-pwa.png",
            tag: "security-alert",
            vibrate: [200, 100, 200, 100, 200],
            data: { url: '/guard' }
        } : {
            title: "SISTEMA NORMALIZADO",
            body: data.explanation ? `Alerta desactivada. Motivo: ${data.explanation}` : "La alerta ha sido desactivada.",
            icon: "/iconos/sildan-pwa.png",
            tag: "security-alert",
            data: { url: '/guard' }
        };

        sendPushToAll(pushPayload);

        // NOTIFICACIÓN WHATSAPP (Solo si se activa)
        if (isAlertActive) {
            try {
                const waNumber = await prisma.setting.findUnique({ where: { key: "WAHA_NOTIFICATION_NUMBER" } });
                if (waNumber && waNumber.value) {
                    const message = `🚨 *BOTÓN DE PÁNICO ACTIVADO* 🚨\n\n*Activado por:* ${data.triggeredBy || 'Compañero'}\n*Hora:* ${new Date().toLocaleTimeString('es-UY')}\n\n*Ubicación:* ${loc && loc.lat ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}` : "S/ data GPS"}\n\n_OmniAccess Seguridad_`;
                    await sendWahaText(prisma, waNumber.value, message);
                }
            } catch (err) {
                console.error("[WAHA] Error notifying alert toggle:", err);
            }
        }

    });
});

global.io = io;

// Escuchamos en todas las interfaces explícitamente ("0.0.0.0")
httpServer.listen(port, "0.0.0.0", () => {
    console.log(`\n🚀 SERVIDOR UNIFICADO ACTIVO EN EL PUERTO ${port}`);
    console.log(`> LPR/Face Webhooks: http://[TU_IP]:${port}/api/webhooks/...`);
    console.log(`> WebSockets: ws://[TU_IP]:${port}`);
    console.log(`> Registro de conexiones activado para diagnóstico.\n`);
});


