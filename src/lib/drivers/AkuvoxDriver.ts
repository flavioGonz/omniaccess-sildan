import { IDeviceDriver, IFaceDriver, IRfidDriver, ILogDriver, IStatsDriver } from "./IDeviceDriver";
import { Device, Credential, AuthType } from "@prisma/client";
import axios from "axios";
import * as fs from "fs";
import * as crypto from "crypto";
import * as path from "path";
import {
    authenticatedRequest,
    getBasicAuthHeader,
    httpsAgent,
    DigestAuthDevice
} from "../digest-auth";

/**
 * Lista canónica de modelos Android de Akuvox.
 * Usada por AkuvoxDriver y server.js para determinar comportamiento específico.
 */
export const AKUVOX_ANDROID_MODELS = ["R29", "X915", "X916", "E16", "E18", "A05", "A095"];

export class AkuvoxDriver implements IFaceDriver, IRfidDriver, ILogDriver, IStatsDriver {

    private async request(method: "GET" | "POST", path: string, data: any, device: Device, timeout: number = 30000): Promise<any> {
        const authDevice: DigestAuthDevice = {
            ip: device.ip,
            username: device.username,
            password: device.password,
            authType: device.authType,
        };

        return authenticatedRequest(method, path, authDevice, {
            data,
            timeout,
        });
    }

    public getAuthHeader(device: Device): Record<string, string> {
        if (!device.username || !device.password || device.authType === 'NONE') {
            return {};
        }
        return getBasicAuthHeader(device.username, device.password);
    }

    public getBaseUrl(device: Device): string {
        return `http://${device.ip}`;
    }

    async getSystemInfo(device: Device): Promise<any> {
        try {
            const response = await this.request("POST", "/api/system/get", {
                "target": "system",
                "action": "get",
                "data": {}
            }, device);
            return response.data;
        } catch (error: any) {
            console.error(`[Akuvox] Error fetching system info from ${device.ip}:`, error.message);
            throw error;
        }
    }

    public isAndroidModel(model: string | null): boolean {
        if (!model) return false;
        return AKUVOX_ANDROID_MODELS.some(m => model.toUpperCase().includes(m));
    }

    public getLiveStreamURL(device: Device): string {
        // We avoid forcing 8080 unless explicitly needed, defaulting to standard 80
        const path = this.isAndroidModel(device.deviceModel) ? "/live.mjpg" : "/fcgi/video.cgi";
        return `http://${device.ip}${path}`;
    }

    public getSnapshotURL(device: Device): string {
        return `http://${device.ip}/api/camera/snapshot`;
    }

    async getDoorStatus(device: Device): Promise<any> {
        try {
            // Akuvox devices often don't have a direct "door status" API.
            // This might be part of system info or require a specific event listener.
            // For now, returning a placeholder or fetching general status.
            // If a specific API exists, it should be implemented here.
            console.warn(`[Akuvox] getDoorStatus not fully implemented for Akuvox devices. Returning placeholder.`);
            return { doorOpen: false, lastEvent: null };
        } catch (error: any) {
            console.error(`[Akuvox] Error fetching door status from ${device.ip}:`, error.message);
            throw error;
        }
    }

    async getDeviceStats(device: Device) {
        try {
            // First try to get unified system info
            const sysInfo = await this.getSystemInfo(device);
            const doorStatus = await this.getDoorStatus(device);
            // Usamos /api/user/get para obtener el total de identidades
            const [users, cards] = await Promise.all([
                this.request("POST", "/api/user/get",
                    { "target": "user", "action": "get", "data": { "offset": 0, "num": 1 } },
                    device,
                    15000 // Increased timeout for stats
                ),
                this.request("POST", "/api/rfkey/get",
                    { "target": "rfkey", "action": "get", "data": { "offset": 0, "num": 1 } },
                    device,
                    15000 // Increased timeout for stats
                )
            ]);

            return {
                faces: users?.data?.num || 0,
                tags: cards?.data?.num || 0
            };
        } catch (error) {
            console.error("[Akuvox] Error fetching stats:", error);
            return { faces: 0, tags: 0 };
        }
    }

    async upsertCredential(credential: Credential, device: Device): Promise<void> {

        if (credential.type === 'TAG') {
            await this.syncRfKey(credential, device);
        } else if (credential.type === 'FACE') {
            // Deprecated path, now using syncUserWithFace
        } else {
        }
    }

    // Generar un ID numérico determinista basado en el ID de la base de datos (string)
    // Usa FNV-1a hash con 9 dígitos (999,999,999 valores) para minimizar colisiones
    private getNumericId(stringId: string): string {
        // FNV-1a 32-bit hash — much better distribution than djb2
        let hash = 0x811c9dc5; // FNV offset basis
        for (let i = 0; i < stringId.length; i++) {
            hash ^= stringId.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193); // FNV prime
        }
        // 9 dígitos: 999M valores posibles (colisión ~0.05% con 10K usuarios)
        return Math.abs(hash % 999999999).toString().padStart(9, '0');
    }

    async syncUserWithFace(user: any, device: Device) {

        const akuvoxId = this.getNumericId(user.id);

        // Extract Credentials
        const tags = user.credentials?.filter((c: any) => (c.type === 'TAG' || c.type === 'CARD') && c.value).map((c: any) => c.value) || [];
        const pinCred = user.credentials?.find((c: any) => c.type === 'PIN' && c.value);
        const pin = pinCred ? pinCred.value : undefined;

        try {
            // 1. Create User with basic info + credentials
            // Fields like LiftFloorNum and WebRelay are required for Linux AC models
            const userPayload: any = {
                "ID": akuvoxId,
                "UserID": akuvoxId, // Required for many models
                "Name": user.name,
                "UserCode": akuvoxId,
                "Type": "0",          // 0 = General User
                "Group": "Default",   // Default Group
                "Role": "-1",         // Standard Role
                "ScheduleRelay": "1001-1;", // Mandatory format for Linux AC
                "Schedule": "1:1001", // Legacy/Backup format
                "LiftFloorNum": "0",  // Mandatory for Linux AC
                "WebRelay": "0",      // Mandatory for Linux AC
                "DoorNum": "1"        // Fallback for some models
            };

            if (tags.length > 0) userPayload["CardCode"] = tags.join(',');
            if (pin) userPayload["PrivatePIN"] = pin;

            // Strategy for Linux AC (A05, etc.): They sometimes expect a Base64 image field inside the user item
            if (user.cara) {
                try {
                    let imageBuffer: Buffer | null = null;
                    if (user.cara.startsWith("/")) {
                        const localPath = path.join(process.cwd(), "public", user.cara);
                        if (fs.existsSync(localPath)) imageBuffer = fs.readFileSync(localPath);
                    } else if (user.cara.startsWith("http")) {
                        const resp = await axios.get(user.cara, { responseType: 'arraybuffer', timeout: 5000 });
                        imageBuffer = Buffer.from(resp.data);
                    }

                    if (imageBuffer) {
                        const base64 = imageBuffer.toString('base64');
                        userPayload["Image"] = base64; // Linux AC specific field
                        userPayload["FaceImage"] = base64; // Alternative field name
                    }
                } catch (e: any) {
                    console.warn(`[Akuvox] Could not embed face in user payload: ${e.message}`);
                }
            }


            try {
                await this.request("POST", "/api/user/add", {
                    "target": "user",
                    "action": "add",
                    "data": { "item": [userPayload] }
                }, device);
            } catch (addError: any) {
                await this.request("POST", "/api/user/set", {
                    "target": "user",
                    "action": "set",
                    "data": { "item": [userPayload] }
                }, device);
            }

        } catch (error: any) {
            console.error(`[Akuvox] Error adding user core data:`, error.message);
            throw new Error(`Error al crear usuario en el dispositivo: ${error.message}`);
        }

        // 2. Add/Set Face (Atomic secondary strategy for Android/General)
        if (user.cara) {
            try {
                let imageBuffer: Buffer | null = null;
                if (user.cara.startsWith("/")) {
                    const localPath = path.join(process.cwd(), "public", user.cara);
                    if (fs.existsSync(localPath)) imageBuffer = fs.readFileSync(localPath);
                } else if (user.cara.startsWith("http")) {
                    const response = await axios.get(user.cara, { responseType: 'arraybuffer', timeout: 10000 });
                    imageBuffer = Buffer.from(response.data);
                }

                if (imageBuffer) {
                    const base64 = imageBuffer.toString('base64');
                    // Try /api/face/add then /api/face/set
                    try {
                        await this.request("POST", "/api/face/add", {
                            "target": "face", "action": "add",
                            "data": { "ID": akuvoxId, "Image": base64, "UserID": akuvoxId }
                        }, device);
                    } catch (e) {
                        await this.request("POST", "/api/face/set", {
                            "target": "face", "action": "set",
                            "data": { "ID": akuvoxId, "Image": base64, "UserID": akuvoxId }
                        }, device);
                    }
                }
            } catch (error: any) {
                console.warn(`[Akuvox] Warning: Face Sync via module failed: ${error.message}`);
            }
        }
    }

    async syncRfKey(credential: Credential, device: Device) {
        const path = "/api/rfkey/add";
        // ID determinístico basado en credential.id para evitar duplicados en cada sync
        const internalId = this.getNumericId(credential.id);

        const payload = {
            "target": "rfkey",
            "action": "add",
            "data": {
                "item": [
                    {
                        "ID": internalId,
                        "Code": credential.value,
                        "DoorNum": "1",
                        "Tags": "0",
                        "Mon": "1", "Tue": "1", "Wed": "1", "Thur": "1", "Fri": "1", "Sat": "1", "Sun": "1",
                        "TimeStart": "00:00",
                        "TimeEnd": "00:00"
                    }
                ]
            }
        };

        try {
            const response = await this.request("POST", path, payload, device);
            if (response && response.retcode === 0) {
            } else {
                console.warn(`[Akuvox] RFKey sync failed: ${JSON.stringify(response)}`);
            }
        } catch (error: any) {
            console.error(`[Akuvox] Error calling RFKey API:`, error.message);
        }
    }

    async triggerRelay(device: Device): Promise<void> {
        try {
            // Updated Open Door commands based on official API documentation
            // Using specific relay-only credentials fallback if provided: api / Api*2011
            const relayUser = "api";
            const relayPass = "Api*2011";
            const doorNum = "1"; // Default to Relay A


            // Strategy 1: Unified JSON API (Android/Linux)
            try {
                const response = await this.request("POST", "/api/relay/trig", {
                    "target": "relay",
                    "action": "trig",
                    "data": {
                        "mode": 0, // Auto Close
                        "num": Number(doorNum),
                        "level": 0, // NO-COM
                        "delay": 5
                    }
                }, device);

                if (response?.retcode === 0) {
                    return;
                }
            } catch (e: any) {
                console.warn(`[Akuvox] Unified Trigger failed:`, e.message);
            }

            // Strategy 2: Standard CGI (Legacy)
            const path1 = `/fcgi/do?action=OpenDoor&UserName=${relayUser}&Password=${relayPass}&DoorNum=${doorNum}`;
            try {
                const response = await this.request("GET", path1, null, device);
                return;
            } catch (error: any) {
                console.warn(`[Akuvox] Standard OpenDoor failed, trying High Security URL...`);
                // Method 2: High Security (Basic Auth in URL)
                const highSecurityUrl = `http://${relayUser}:${relayPass}@${device.ip}/fcgi/OpenDoor?action=OpenDoor&DoorNum=${doorNum}`;
                const response = await axios.get(highSecurityUrl, { timeout: 5000 }).then(r => r.data);
            }

        } catch (error: any) {
            console.error(`[Akuvox] Error triggering door on ${device.ip}:`, error.message);
            throw error;
        }
    }

    async syncAllFromDevice(device: Device): Promise<any[]> {
        // This method will fetch all users (faces and tags) from the device
        // and return them in a unified format.
        return this.getFaceList(device); // getFaceList now handles both faces and tags via user module
    }

    async getFacesFromCamera(device: Device): Promise<any[]> {
        return this.getFaceList(device);
    }

    async getFaceList(device: Device): Promise<any[]> {
        let users: any[] = [];
        let faceInternalIds: Set<string> = new Set();
        let faceUserIds: Set<string> = new Set();

        try {
            // 1. Get Users (with timeout)
            try {
                const data = await Promise.race([
                    this.request("POST", "/api/user/get",
                        { "target": "user", "action": "get", "data": { "offset": 0, "num": 200 } },
                        device
                    ),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout getting users')), 30000))
                ]);

                if (data && data.retcode === 0) {
                    users = data.data.item || [];
                }
            } catch (error) {
                console.warn(`[Akuvox] Warning: Could not fetch users (Device might be offline or busy). Returning empty list.`);
                return [];
            }

            // 2. Get Face List (with timeout)
            try {
                const data = await Promise.race([
                    this.request("POST", "/api/face/list",
                        { "target": "face", "action": "list", "data": { "offset": 0, "num": 200 } },
                        device
                    ),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout getting faces')), 30000))
                ]);

                if (data && data.retcode === 0) {
                    const items = data.data.item || [];
                    items.forEach((f: any) => {
                        if (f.ID) faceInternalIds.add(String(f.ID).trim());
                        if (f.UserID) faceUserIds.add(String(f.UserID).trim());
                    });
                }
            } catch (error) {
                console.error(`[Akuvox] Error fetching face list:`, error);
                // Continue anyway with user list
            }

            // 3. Merge safely
            return users.map((u: any, index: number) => {
                const uID = String(u.ID || "").trim();
                const uUserID = String(u.UserID || "").trim();
                const uFaceNum = parseInt(u.FaceNum || "0");

                const hasFace =
                    faceInternalIds.has(uID) ||
                    faceUserIds.has(uUserID) ||
                    uFaceNum > 0 ||
                    (u.FaceUrl && u.FaceUrl.length > 5) ||
                    (u.FaceId && String(u.FaceId) !== "0"); // New check for FaceId field

                const faceUrl = (hasFace || u.FaceUrl)
                    ? `/api/proxy/device-image?deviceId=${device.id}&userId=${u.ID}&altId=${u.UserID || ''}&path=${encodeURIComponent(u.FaceUrl || u.FaceImage || '')}`
                    : "";

                return {
                    Index: index + 1,
                    ID: u.ID,
                    Name: u.Name,
                    UserID: u.UserID,
                    UserCode: u.UserCode || "", // Capture specific UserCode from device
                    HasFace: hasFace,
                    FaceUrl: faceUrl,
                    CardCode: u.CardCode || "",
                    HasTag: u.CardCode && u.CardCode !== "",
                    PIN: u.Password || ""
                };
            });
        } catch (error) {
            console.error(`[Akuvox] Error in getFaceList:`, error);
            throw error;
        }
    }

    async getFaceImage(device: Device, userId?: string | null, altId?: string, specificPath?: string): Promise<Buffer | null> {
        try {
            // 0. Try specific path if provided (e.g. from FaceUrl field)
            if (specificPath && specificPath.length > 2 && specificPath !== "undefined" && specificPath !== "null") {
                let url = specificPath;
                if (!url.startsWith("http")) {
                    if (!url.startsWith("/")) url = "/" + url;
                    url = `${this.getBaseUrl(device)}${url}`;
                }
                try {
                    const response = await axios.get(url, {
                        responseType: 'arraybuffer',
                        headers: this.getAuthHeader(device),
                        httpsAgent,
                        timeout: 15000,
                        validateStatus: () => true
                    });
                    if (response.status === 200) {
                        // Relaxed check: if it returns 200 and has bytes, assume image
                        return Buffer.from(response.data);
                    }
                } catch (e) {
                    console.warn(`[Akuvox] Specific path failed. Falling back to ID search.`);
                }
            }

            // Combinamos todos los IDs posibles para probar
            const idsToTry = [userId].filter(id => id !== null && id !== undefined);
            if (altId && !idsToTry.includes(altId)) idsToTry.push(altId);

            // Parámetros de URL comunes en diferentes firmwares
            const paramNames = ["id", "FaceId", "UserID"];

            for (const idValue of idsToTry) {
                for (const paramName of paramNames) {
                    const url = `${this.getBaseUrl(device)}/api/face/get?${paramName}=${idValue}`;

                    const response = await axios.get(url, {
                        responseType: 'arraybuffer',
                        headers: this.getAuthHeader(device),
                        httpsAgent: httpsAgent,
                        timeout: 10000,
                        validateStatus: () => true
                    });

                    if (response.status === 401 && device.authType === 'DIGEST') {
                        // Lógica de Digest (simplificada para reintento)
                        const retryBuffer = await this.getFaceImageDigest(url, device);
                        if (retryBuffer) return retryBuffer;
                    }

                    if (response.status === 200) {
                        const contentType = response.headers['content-type'] || "";

                        // Si es una imagen directa, devolvemos el buffer
                        if (contentType.includes("image/")) {
                            return Buffer.from(response.data);
                        }

                        // Si es un JSON (algunos firmwares devuelven {Image: "base64"}), lo parseamos
                        try {
                            const str = Buffer.from(response.data).toString('utf8');
                            if (str.trim().startsWith("{")) {
                                const json = JSON.parse(str);
                                const base64 = json.data?.Image || json.Image || json.data?.item?.[0]?.Image;
                                if (base64) {
                                    return Buffer.from(base64, 'base64');
                                }
                            }
                        } catch (e) { /* No era JSON válido o no tenía imagen */ }
                    }
                }
            }
        } catch (error) {
            console.error(`[Akuvox] Error final getting face image:`, error);
        }
        return null;
    }

    private async getFaceImageDigest(url: string, device: Device): Promise<Buffer | null> {
        // Obtenemos el header WWW-Authenticate
        try {
            const firstResponse = await axios.get(url, { httpsAgent, validateStatus: () => true });
            const authHeader = firstResponse.headers['www-authenticate'];
            if (!authHeader) return null;

            const getVal = (key: string) => {
                const match = authHeader.match(new RegExp(`${key}="?([^",]+)"?`));
                return match ? match[1] : null;
            };

            const realm = getVal("realm");
            const nonce = getVal("nonce");
            const qop = getVal("qop");
            const opaque = getVal("opaque");
            const algorithm = getVal("algorithm") || "MD5";

            const path = new URL(url).pathname + new URL(url).search;
            const method = "GET";

            const ha1 = crypto.createHash("md5").update(`${device.username}:${realm}:${device.password}`).digest("hex");
            const ha2 = crypto.createHash("md5").update(`${method}:${path}`).digest("hex");
            const nc = "00000001";
            const cnonce = crypto.randomBytes(8).toString("hex");

            let responseStr;
            if (qop) {
                responseStr = crypto.createHash("md5").update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`).digest("hex");
            } else {
                responseStr = crypto.createHash("md5").update(`${ha1}:${nonce}:${ha2}`).digest("hex");
            }

            const authString = `Digest username="${device.username}", realm="${realm}", nonce="${nonce}", uri="${path}", qop="${qop || ''}", nc=${nc}, cnonce="${cnonce}", response="${responseStr}", opaque="${opaque || ''}", algorithm="${algorithm}"`;

            const retryResponse = await axios.get(url, {
                responseType: 'arraybuffer',
                headers: { Authorization: authString },
                httpsAgent,
                timeout: 10000
            });

            if (retryResponse.status === 200) {
                const contentType = retryResponse.headers['content-type'] || "";
                if (contentType.includes("image/")) {
                    return Buffer.from(retryResponse.data);
                }
                const str = Buffer.from(retryResponse.data).toString('utf8');
                if (str.trim().startsWith("{")) {
                    const json = JSON.parse(str);
                    const base64 = json.data?.Image || json.Image;
                    if (base64) return Buffer.from(base64, 'base64');
                }
            }
        } catch (e) {
            console.error("[Akuvox] Digest retry failed", e);
        }
        return null;
    }



    async deleteFace(device: Device, faceId: string, userId?: string, userCode?: string): Promise<boolean> {

        const tryAction = async (data: any, strategyName: string) => {
            // Try standard "delete"
            try {
                const res = await this.request("POST", "/api/user/delete", {
                    "target": "user", "action": "delete", "data": data
                }, device);
                if (res && res.retcode === 0) return true;

                // If unsupport action, try "del"
                if (res && (res.message?.includes("unsupport") || res.retcode === -1)) {
                    const resDel = await this.request("POST", "/api/user/delete", {
                        "target": "user", "action": "del", "data": data
                    }, device);
                    if (resDel && resDel.retcode === 0) return true;

                    // Try "remove"
                    const resRemove = await this.request("POST", "/api/user/delete", {
                        "target": "user", "action": "remove", "data": data
                    }, device);
                    if (resRemove && resRemove.retcode === 0) return true;
                }
            } catch (e: any) {
                console.warn(`[Akuvox] ${strategyName} failed:`, e.message);
            }
            return false;
        };

        const tryLegacyCGI = async (urlParams: string) => {
            const url = `${this.getBaseUrl(device)}/fcgi/do?action=DeleteUser&${urlParams}`;
            try {
                const response = await axios.get(url, {
                    headers: this.getAuthHeader(device),
                    httpsAgent,
                    timeout: 5000,
                    validateStatus: () => true
                });
                if (response.status === 200 && (response.data?.includes("success") || response.data?.retcode === 0)) {
                    return true;
                }
            } catch (e: any) {
                console.warn(`[Akuvox] CGI failed:`, e.message);
            }
            return false;
        };

        // Strategy 1: Delete by Internal ID (Array)
        if (await tryAction({ "ID": [String(faceId)] }, "Strategy 1 (ID)")) return true;

        // Strategy 2: Delete by Internal ID (String)
        if (await tryAction({ "ID": String(faceId) }, "Strategy 2 (ID String)")) return true;

        // Strategy 3: Delete by UserID
        if (userId && userId !== "undefined") {
            if (await tryAction({ "UserID": [String(userId)] }, "Strategy 3 (UserID)")) return true;
        }

        // Strategy 4: Delete by UserCode
        const codeToTry = userCode || userId;
        if (codeToTry && codeToTry !== "undefined") {
            if (await tryAction({ "UserCode": [String(codeToTry)] }, "Strategy 4 (UserCode)")) return true;
        }

        // Strategy 5: Legacy CGI - UserID
        if (userId && await tryLegacyCGI(`UserID=${userId}`)) return true;

        // Strategy 6: Legacy CGI - ID
        if (await tryLegacyCGI(`ID=${faceId}`)) return true;

        console.error(`[Akuvox] All delete strategies failed for ${faceId}/${userId}`);
        return false;
    }

    async getDoorlog(device: Device, num: number = 50, offset: number = 0): Promise<any[]> {
        const logApis = ["doorlog", "searchlog", "accesslog"];

        for (const api of logApis) {
            const payload = {
                "target": api,
                "action": "get",
                "data": {
                    "offset": offset,
                    "num": num
                }
            };

            try {
                const response = await this.request("POST", `/api/${api}/get`, payload, device);

                if (response && response.retcode === 0 && response.data?.item) {
                    return response.data.item.map((item: any) => {
                        let date = item.Date || item.date || "";
                        let time = item.Time || item.time || "";

                        if (time.includes(' ') && (time.includes('-') || time.includes('/'))) {
                            const [d, t] = time.split(' ');
                            date = d;
                            time = t;
                        } else if (time && !date && !time.includes('-') && !time.includes('/')) {
                            date = new Date().toISOString().split('T')[0];
                        }

                        if (!item.PicUrl && !item.PicPath && !item.pic_url && !item.snap_path && date && time) {
                            item.PicPath = `PROXY_FACE|${date}|${time}`;
                        }

                        return { ...item, Date: date, Time: time };
                    });
                }

                if (!response || response.retcode !== 0) {
                    const getResponse = await this.request("GET", `/api/${api}/get?num=${num}&offset=${offset}`, null, device);
                    if (getResponse && getResponse.retcode === 0 && getResponse.data?.item) {
                        return getResponse.data.item.map((item: any) => {
                            let date = item.Date || item.date || "";
                            let time = item.Time || item.time || "";

                            if (time.includes(' ') && (time.includes('-') || time.includes('/'))) {
                                const [d, t] = time.split(' ');
                                date = d;
                                time = t;
                            } else if (time && !date && !time.includes('-') && !time.includes('/')) {
                                date = new Date().toISOString().split('T')[0];
                            }

                            if (!item.PicUrl && !item.PicPath && !item.pic_url && !item.snap_path && date && time) {
                                item.PicPath = `PROXY_FACE|${date}|${time}`;
                            }
                            return { ...item, Date: date, Time: time };
                        });
                    }
                }
            } catch (error: any) {
                console.warn(`[Akuvox] Failed to fetch from ${api}:`, error.message);
                // Continue to next API
            }
        }

        return [];
    }

    async getCalllog(device: Device, num: number = 50, offset: number = 0): Promise<any[]> {
        const payload = {
            "target": "calllog",
            "action": "get",
            "data": {
                "offset": offset,
                "num": num
            }
        };

        try {
            const response = await this.request("POST", "/api/calllog/get", payload, device);

            if (response && response.retcode === 0 && response.data?.item) {
                return response.data.item.map((item: any) => {
                    if (item.Time && (!item.Date || !item.TimeOnly)) {
                        const [d, t] = item.Time.split(' ');
                        return { ...item, Date: d, Time: t || d };
                    }
                    return item;
                });
            }

            // Fallback: Some versions might use GET
            if (!response || response.retcode !== 0) {
                const getResponse = await this.request("GET", `/api/calllog/get?num=${num}&offset=${offset}`, null, device);
                if (getResponse && getResponse.retcode === 0) {
                    return getResponse.data?.item || [];
                }
            }

            return [];
        } catch (error) {
            console.error("[Akuvox] Error fetching calllog:", error);
            return [];
        }
    }
}
