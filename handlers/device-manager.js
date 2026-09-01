const axios = require("axios");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const { isValidImage } = require("./shared");

const agent = new https.Agent({ rejectUnauthorized: false });

let prisma, io;

function init(deps) {
    prisma = deps.prisma;
    io = deps.io;
}

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
        
        
        if (global.io) {
            io && io.emit("device_adopted", newDevice);
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
                        const digestResult = await tryFetchWithDigest(urlToTry, path, device);
                        if (digestResult) {
                            return digestResult;
                        }
                    } else if (wwwAuth.toLowerCase().includes("basic")) {
                        const resBasic = await axios.get(urlToTry, {
                            headers: { 'Authorization': authHeaderBasic },
                            responseType: 'arraybuffer',
                            timeout: 4000
                        });
                        if (isValidImage(resBasic.data, resBasic.headers['content-type'])) {
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
        const fullUrl = options.path.startsWith('http') ? options.path : `${baseUrl}${options.path.startsWith('/') ? '' : '/'}${options.path}`;
        const buffer = await makeRequest(fullUrl, false);
        if (isValidImage(buffer)) {
            return buffer;
        }
        console.warn(`[Akuvox] Strategy 0 failed: Path provided but no valid image found at ${fullUrl}`);
    }

    // Strategy 1: Log Polling (doorlog, searchlog)
    const logApis = ["doorlog", "searchlog", "accesslog"];
    const apiPorts = [null, "8080"];

    for (let retry = 0; retry < 2; retry++) { // Reduced from 6 retries to 2

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

                                    const buffer = await makeRequest(fullImageUrl, false);
                                    if (isValidImage(buffer)) {
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
    return await fetchCameraSnapshot(device);
};


module.exports = { init, adoptDevice, fetchCameraSnapshot, getAkuvoxFaceFilename, fetchAkuvoxFaceImage };
