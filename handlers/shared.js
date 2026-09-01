const crypto = require("crypto");
const Busboy = require("busboy");

// ---- Debounce Cache ----
const debounceCache = new Map();
const DEBOUNCE_TIME = parseInt(process.env.DEBOUNCE_TIME) || 6000;

const DEBOUNCE_CLEANUP_INTERVAL = 60000;
setInterval(() => {
    const now = Date.now();
    for (const [plate, timestamp] of debounceCache) {
        if (now - timestamp > DEBOUNCE_TIME * 2) debounceCache.delete(plate);
    }
}, DEBOUNCE_CLEANUP_INTERVAL);

function isDuplicate(plate) {
    const now = Date.now();
    const normalized = plate.toUpperCase().trim();
    const lastSeen = debounceCache.get(normalized);
    if (lastSeen && (now - lastSeen) < DEBOUNCE_TIME) {
        return true;
    }
    debounceCache.set(normalized, now);
    return false;
}

// ---- Debug Logs ----
const debugLogsHistory = [];
const MAX_DEBUG_LOGS = 200;

function addDebugLog(entry) {
    debugLogsHistory.push({
        ...entry,
        timestamp: new Date().toISOString(),
    });
    if (debugLogsHistory.length > MAX_DEBUG_LOGS) {
        debugLogsHistory.shift();
    }
}

function getDebugLogs() {
    return debugLogsHistory;
}

// ---- Alert State ----
let isAlertActive = false;
let globalLastAlertUpdateTime = Date.now();
const guardLocations = new Map();
const activeMissions = new Map();

function getAlertState() {
    return { isAlertActive, globalLastAlertUpdateTime, guardLocations, activeMissions };
}

function setAlertState(state) {
    if (state.isAlertActive !== undefined) isAlertActive = state.isAlertActive;
    if (state.globalLastAlertUpdateTime !== undefined) globalLastAlertUpdateTime = state.globalLastAlertUpdateTime;
}

// ---- Helpers ----
function isValidImage(buffer) {
    if (!buffer || buffer.length < 4) return false;
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) return true; // JPEG
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return true; // PNG
    return false;
}

function formatEventDate(date) {
    if (!date) return new Date().toISOString();
    const d = date instanceof Date ? date : new Date(date);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function sanitizeName(name) {
    if (!name) return "";
    return name.replace(/[<>"'&]/g, "").substring(0, 200);
}

function generateId() {
    return crypto.randomBytes(12).toString("hex");
}

// ---- Multipart Parser (Hikvision/Avicam/Akuvox compatible) ----
function parseMultipart(req) {
    return new Promise((resolve, reject) => {
        const busboy = Busboy({ headers: req.headers });
        const result = { xmlContent: "", jsonContent: "", images: [] };
        const filePromises = [];

        busboy.on('file', (name, file, info) => {
            const { filename, encoding, mimeType } = info;

            const chunks = [];
            file.on('data', (chunk) => chunks.push(chunk));

            const p = new Promise((res, rej) => {
                file.on('end', () => {
                    const buffer = Buffer.concat(chunks);

                    if (mimeType.includes("image") || name.toLowerCase().includes("pic") || name.toLowerCase().includes("image") || name.toLowerCase().includes("capture")) {
                        result.images.push({
                            buffer: buffer,
                            mimeType: mimeType || 'image/jpeg',
                            size: buffer.length,
                            name: name
                        });
                    } else {
                        const text = buffer.toString('utf8').trim();
                        if (text.startsWith('{') || text.startsWith('[')) {
                            result.jsonContent = text;
                        } else if (text.startsWith('<')) {
                            result.xmlContent = text;
                        } else {
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
}

module.exports = {
    debounceCache, DEBOUNCE_TIME, isDuplicate,
    debugLogsHistory, addDebugLog, getDebugLogs,
    getAlertState, setAlertState, guardLocations, activeMissions,
    isValidImage, formatEventDate, sanitizeName, generateId,
    parseMultipart, MAX_DEBUG_LOGS,
};
