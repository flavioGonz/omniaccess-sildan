const axios = require("axios");
const https = require("https");
const crypto = require("crypto");

const agent = new https.Agent({ rejectUnauthorized: false });

const tryFetchWithDigest = async (url, path, device, method = "GET") => {
    try {
        // First call to get nonce (with no auth)
        const firstRes = await axios({
            method: method,
            url: url,
            validateStatus: () => true,
            timeout: 15000,
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
                timeout: 20000,
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
            timeout: 30000,
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
                            sourceRes = await tryStreamWithDigest(streamUrl, path, device);
                        } else {
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
                        activeSource.destroy();
                        activeSource = null;
                        continue;
                    }

                    if (isClosed) {
                        activeSource.destroy();
                        return true;
                    }

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

module.exports = { tryFetchWithDigest, proxyVideoStream, tryStreamWithDigest };
