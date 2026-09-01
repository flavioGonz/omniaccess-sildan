import axios from "axios";
import { IDeviceDriver, ILprDriver, IFaceDriver, ILogDriver } from "./IDeviceDriver";
import { Device, Credential, CredentialType, AuthType } from "@prisma/client";
import {
    authenticatedRequest,
    parseWWWAuthenticate,
    buildDigestHeader,
    httpsAgent,
    DigestAuthDevice
} from "../digest-auth";
import crypto from "crypto";

export class HikvisionDriver implements ILprDriver, IFaceDriver, ILogDriver {
    /**
     * JSON request with automatic Basic/Digest auth via shared module.
     * Includes Hikvision-specific fallback: retry with path-only URI if query params cause 401.
     */
    private async request(
        method: "GET" | "POST" | "PUT" | "DELETE",
        url: string,
        data: any,
        device: Device
    ): Promise<any> {
        const authDevice: DigestAuthDevice = {
            ip: device.ip,
            username: device.username || "admin",
            password: device.password || "12345",
            authType: device.authType,
        };

        try {
            return await authenticatedRequest(method, url, authDevice, {
                data,
                contentType: "application/json",
                accept: "application/json",
                timeout: 10000,
            });
        } catch (error: any) {
            // Hikvision-specific: some cameras need path-only URI (no query params) for digest
            if (error.response?.status === 401 && url.includes("?")) {
                const pathOnly = url.split("?")[0];
                return await authenticatedRequest(method, pathOnly, authDevice, {
                    data,
                    contentType: "application/json",
                    accept: "application/json",
                    timeout: 15000,
                });
            }
            throw error;
        }
    }

    /**
     * Captura un snapshot JPEG del canal principal vía ISAPI (Digest).
     * Endpoint confiable: GET /ISAPI/Streaming/channels/<ch>01/picture
     * Devuelve el Buffer JPEG o null si falla.
     */
    async captureSnapshot(device: Device, channel: number = 1): Promise<Buffer | null> {
        const authDevice: DigestAuthDevice = {
            ip: device.ip,
            username: device.username || "admin",
            password: device.password || "12345",
            authType: device.authType,
        };
        const candidates = [`${channel}01`, `${channel}`, "101", "1"];
        const seen = new Set<string>();
        for (const ch of candidates) {
            if (seen.has(ch)) continue; seen.add(ch);
            try {
                const data = await authenticatedRequest(
                    "GET",
                    `/ISAPI/Streaming/channels/${ch}/picture`,
                    authDevice,
                    { accept: "image/jpeg", responseType: "arraybuffer", timeout: 12000 }
                );
                const buf = Buffer.from(data);
                if (buf && buf.length > 500) return buf; // sanity: real JPEG, not an error page
            } catch (e) { /* try next channel */ }
        }
        return null;
    }

    /**
     * Lee /ISAPI/System/deviceInfo (Digest) -> model, firmware, MAC, serie, tipo.
     */
    async getDeviceInfo(device: Device): Promise<Record<string, string>> {
        const xml: string = await this.requestXML("GET", "/ISAPI/System/deviceInfo", null, device);
        const pick = (t: string) => {
            const m = (xml || "").match(new RegExp("<" + t + ">([^<]*)</" + t + ">"));
            return m ? m[1].trim() : "";
        };
        return {
            deviceName: pick("deviceName"),
            model: pick("model"),
            firmwareVersion: pick("firmwareVersion"),
            firmwareReleasedDate: pick("firmwareReleasedDate"),
            macAddress: pick("macAddress"),
            serialNumber: pick("serialNumber"),
            deviceType: pick("deviceType"),
        };
    }

    async upsertCredential(credential: Credential, device: Device): Promise<void> {
        if (credential.type === CredentialType.PLATE) {
            try {
                process.stdout.write(`Syncing plate ${credential.value} to ${device.ip}... `);
                await this.addPlateToCamera(device, credential.value);
                process.stdout.write("DONE\n");
            } catch (e: any) {
                console.error(`FAILED: ${e.message}`);
            }
        }
    }

    async deleteCredential(credentialValue: string, device: Device): Promise<void> {
        // 1. Try LPR Delete (Traffic API)
        if (device.deviceType === 'LPR_CAMERA') {
            const url = `/ISAPI/Traffic/channels/1/DelLicensePlateAuditData?format=json`;
            const payload = {
                id: [credentialValue],
                deleteAllEnabled: false
            };

            try {
                await this.request("PUT", url, payload, device);
                return;
            } catch (e: any) {
                console.error(`[Hikvision LPR] Failed to delete plate:`, e.message);
            }
        }

        // 2. Try UserInfo Delete (Access Control Terminals)
        try {
            await this.request("PUT", `/ISAPI/AccessControl/UserInfo/Delete?format=json`, {
                UserInfoDelCond: {
                    EmployeeNoList: [{ employeeNo: credentialValue }]
                }
            }, device);
        } catch (e: any) {
            console.error(`[Hikvision AC] Failed to delete user:`, e.message);
        }
    }

    async getPlatesFromCamera(device: Device): Promise<string[]> {
        const searchId = Date.now().toString(16).slice(-8) + Math.random().toString(16).slice(2, 6);
        return this.getPlatesExhaustive(device, searchId);
    }

    /**
     * Internal exhaustive fetch (legacy/background)
     */
    private async getPlatesExhaustive(device: Device, searchId: string): Promise<string[]> {
        const page_size = 400;
        let start_position = 0;
        let all_plates: string[] = [];
        let keep_fetching = true;
        let total_matches = 0;


        while (keep_fetching) {
            const url = `/ISAPI/Traffic/channels/1/searchLPListAudit`;
            const xml_data = `<?xml version="1.0" encoding="UTF-8"?><LPSearchCond><searchID>${searchId}</searchID><maxResult>${page_size}</maxResult><searchResultPosition>${start_position}</searchResultPosition></LPSearchCond>`;

            try {
                const response = await this.requestXML("POST", url, xml_data, device);
                const result = this.parseLPRSearchResponse(response);
                const plates = result.plates;

                if (start_position === 0) {
                    total_matches = result.totalMatches;
                }

                if (plates.length === 0 && result.numOfMatches === 0) {
                    keep_fetching = false;
                } else {
                    all_plates.push(...plates);

                    const advancedBy = result.numOfMatches > 0 ? result.numOfMatches : plates.length;
                    start_position += advancedBy;


                    // Stop condition: Check for "OK" status (end of results) or if we got less than requested
                    const isLastPage = response.includes("<responseStatusStrg>OK</responseStatusStrg>") ||
                        (result.numOfMatches < page_size && result.numOfMatches >= 0);

                    if (isLastPage) {
                        keep_fetching = false;
                    } else if (total_matches > 0 && start_position >= total_matches) {
                        keep_fetching = false;
                    }
                }
            } catch (error: any) {
                console.error(`[Hikvision LPR] Error at pos ${start_position}:`, error.message);
                keep_fetching = false;
            }

            if (start_position > 50000) break;
        }

        // Return all plates as found (Raw). This ensures the UI matches the hardware count.
        // We handle deduplication only when importing or syncing.
        return all_plates;
    }

    /**
     * Individual page fetch for progress tracking in UI
     */
    async getPlatesPage(device: Device, searchId: string, start: number, max: number = 400) {
        const url = `/ISAPI/Traffic/channels/1/searchLPListAudit`;
        const xml_data = `<?xml version="1.0" encoding="UTF-8"?><LPSearchCond><searchID>${searchId}</searchID><maxResult>${max}</maxResult><searchResultPosition>${start}</searchResultPosition></LPSearchCond>`;

        try {
            const response = await this.requestXML("POST", url, xml_data, device);
            const result = this.parseLPRSearchResponse(response);
            const isLastPage = response.includes("<responseStatusStrg>OK</responseStatusStrg>") ||
                (result.numOfMatches < max && result.numOfMatches >= 0);

            return {
                plates: result.plates,
                totalMatches: result.totalMatches,
                numOfMatches: result.numOfMatches,
                isLastPage
            };
        } catch (error: any) {
            console.error(`[Hikvision LPR] Error at pos ${start}:`, error.message);
            throw error;
        }
    }

    /**
     * Deletes ALL plates from the camera whitelist.
     * Matches the PHP 'deleteAllPlatesFromCamera' logic.
     */
    async clearWhiteList(device: Device): Promise<void> {
        const url = `/ISAPI/Traffic/channels/1/DelLicensePlateAuditData?format=json`;
        const payload = {
            id: [],
            deleteAllEnabled: true
        };

        try {
            await this.request("PUT", url, payload, device);
        } catch (error: any) {
            console.error(`[Hikvision LPR] Failed to clear whitelist on ${device.ip}:`, error.message);
            throw error;
        }
    }

    async addPlateToCamera(device: Device, plate: string): Promise<void> {
        const url = `/ISAPI/Traffic/channels/1/licensePlateAuditData/record?format=json`;
        const now = new Date();
        const createTime = now.toISOString().split('.')[0].replace('Z', ''); // YYYY-MM-DDTHH:mm:ss
        const startDate = now.toISOString().split('T')[0];
        const end = new Date();
        end.setFullYear(end.getFullYear() + 10);
        const endDate = end.toISOString().split('T')[0];

        const payload = {
            LicensePlateInfoList: [
                {
                    LicensePlate: plate,
                    listType: "whiteList",
                    createTime: createTime,
                    effectiveStartDate: startDate,
                    effectiveTime: endDate,
                    id: ""
                }
            ]
        };

        await this.request("PUT", url, payload, device);
    }

    async getPlates(device: Device): Promise<string[]> {
        return this.getPlatesFromCamera(device);
    }

    async triggerRelay(device: Device): Promise<void> {
        try {
            await this.request(
                "PUT",
                `/ISAPI/System/IO/outputs/1/trigger?format=json`,
                {
                    IOPortData: {
                        outputState: "high"
                    }
                },
                device
            );
        } catch (e: any) {
            if (e.response?.status === 401) {
                console.error(`[Hikvision Relay] 401 Unauthorized for ${device.ip}. Check credentials.`);
            }
            console.error(`Failed to open gate ${device.ip}:`, e.message);
        }
    }

    private parseLPRSearchResponse(xml: string) {
        const plates = this.extractPlatesFromXML(xml);

        // Improved regex for totalMatches and numOfMatches to handle namespaces (e.g. <search:totalMatches> or <totalMatches xmlns="...">)
        const totalMatchesMatch = xml.match(/<(?:[^:>\s]+:)?totalMatches[^>]*>(\d+)<\/(?:[^:>\s]+:)?totalMatches>/i);
        const totalMatches = totalMatchesMatch ? parseInt(totalMatchesMatch[1]) : 0;

        const numOfMatchesMatch = xml.match(/<(?:[^:>\s]+:)?numOfMatches[^>]*>(\d+)<\/(?:[^:>\s]+:)?numOfMatches>/i);
        const numOfMatches = numOfMatchesMatch ? parseInt(numOfMatchesMatch[1]) : plates.length;


        return {
            plates,
            totalMatches: totalMatches || plates.length, // Fallback if not found but we got plates
            numOfMatches
        };
    }

    private extractPlatesFromXML(xml: string): string[] {
        const plates: string[] = [];
        // Support for a wider range of Hikvision LPR tags
        const tags = [
            "LicensePlate", "licensePlate", "plateNumber", "PlateNumber", "plateNo", "PlateNo", "plateNum"
        ];

        for (const tag of tags) {
            // Regex supporting optional namespace prefix and any attributes
            const regex = new RegExp(`<(?:[^:>\\s]+:)?${tag}[^>]*>([^<]+)</(?:[^:>\\s]+:)?${tag}>`, "gi");
            let match;
            while ((match = regex.exec(xml)) !== null) {
                // Filter out Hikvision placeholders and normalize
                const plate = match[1].trim().toUpperCase();
                if (plate && plate !== 'N/A' && plate !== '*' && plate.length > 2) {
                    plates.push(plate);
                }
            }
        }

        const uniquePlates = Array.from(new Set(plates));
        return uniquePlates;
    }

    /**
     * XML request with automatic Basic/Digest auth via shared module.
     * Returns raw text response for XML parsing.
     */
    private async requestXML(
        method: "GET" | "POST" | "PUT" | "DELETE",
        url: string,
        data: string | null,
        device: Device
    ): Promise<string> {
        const authDevice: DigestAuthDevice = {
            ip: device.ip,
            username: device.username || "admin",
            password: device.password || "12345",
            authType: device.authType,
        };

        try {
            return await authenticatedRequest(method, url, authDevice, {
                data,
                contentType: "application/xml",
                accept: "application/xml",
                responseType: "text",
                timeout: 20000,
            });
        } catch (error: any) {
            // Hikvision-specific: retry with path-only URI
            if (error.response?.status === 401 && url.includes("?")) {
                const pathOnly = url.split("?")[0];
                return await authenticatedRequest(method, pathOnly, authDevice, {
                    data,
                    contentType: "application/xml",
                    accept: "application/xml",
                    responseType: "text",
                    timeout: 25000,
                });
            }
            throw error;
        }
    }

    async getFacesFromCamera(device: Device): Promise<any[]> {
        const allFaces: any[] = [];
        let position = 0;
        const maxResults = 50;

        let keepFetching = true;

        while (keepFetching) {
            try {
                let matches: any[] = [];

                // Try Access Control Terminal (MinMoe)
                const url = `/ISAPI/AccessControl/UserInfo/Search?format=json`;
                // Some devices restrict searchID length/format
                const shortSearchId = Date.now().toString(16).slice(-8);
                const payload = {
                    UserInfoSearchCond: {
                        searchID: shortSearchId,
                        searchResultPosition: position,
                        maxResults: maxResults
                    }
                };

                let data;
                try {
                    data = await this.request("POST", url, payload, device);
                } catch (e: any) {
                    console.warn(`[Hikvision Face] UserInfo/Search failed at pos ${position}: ${e.message}`);
                    if (position === 0) return this.getFacesFromFDSearch(device);
                    break;
                }

                // Use the universal extractor for robustness
                matches = this.extractMatches(data);

                // If the extractor failed but we have data, try manual check for UserInfoSearch specific structure
                if (matches.length === 0 && data?.UserInfoSearch) {
                    if (Array.isArray(data.UserInfoSearch.UserInfo)) matches = data.UserInfoSearch.UserInfo;
                }

                if (matches.length > 0) {
                    allFaces.push(...matches);
                    position += matches.length;

                    if (matches.length < maxResults) keepFetching = false;
                } else {
                    keepFetching = false;
                }

            } catch (error: any) {
                console.error(`[Hikvision Face] Error loop: ${error.message}`);
                keepFetching = false;
            }

            if (position > 5000) keepFetching = false;
        }

        if (allFaces.length === 0) {
            return this.getFacesFromFDSearch(device);
        }

        return allFaces;
    }

    private async getFacesFromFDSearch(device: Device): Promise<any[]> {

        const foundFDIDs: string[] = [];
        // Attempt to list libraries first to find valid UUIDs or IDs
        try {
            const libData = await this.request("GET", "/ISAPI/Intelligent/FDLib?format=json", null, device);
            if (libData?.FDLibList?.FDLib && Array.isArray(libData.FDLibList.FDLib)) {
                libData.FDLibList.FDLib.forEach((l: any) => {
                    const id = l.FDID || l.id || l.ID || l.uuid;
                    if (id) foundFDIDs.push(String(id));
                });
            } else if (libData?.FDLibList && Array.isArray(libData.FDLibList)) {
                libData.FDLibList.forEach((l: any) => {
                    const id = l.FDID || l.id || l.ID || l.uuid;
                    if (id) foundFDIDs.push(String(id));
                });
            }
        } catch (e: any) {
            console.warn(`[Hikvision Face] Could not list FDLib: ${e.message}`);
        }

        // Add common FDIDs and a small range for discovery if listing failed
        const commonFDIDs = [...new Set([...foundFDIDs, "1", "0", "999", "2", "3", "4", "5"])];

        const searchId = "sid_" + Date.now().toString(16).slice(-8);

        // --- PHASE 1: FDLib Strategies (Intelligent Cameras / NVRs) ---
        for (const fdid of commonFDIDs) {
            // Strategy J.1: Direct GET /picture (Listing) - XML preferred
            try {
                const xmlRes = await this.requestXML("GET", `/ISAPI/Intelligent/FDLib/${fdid}/picture`, null, device);
                if (xmlRes && (xmlRes.includes('<name>') || xmlRes.includes('<FaceInfo>') || xmlRes.includes('<FaceRecord>'))) {
                    const results = this.parseFaceXML(xmlRes);
                    if (results.length > 0) {
                        return results;
                    }
                }
            } catch (e) { /* silenced */ }

            // Strategy J.2: Direct GET /picture?format=json (Listing) 
            try {
                const data = await this.request("GET", `/ISAPI/Intelligent/FDLib/${fdid}/picture?format=json`, null, device);
                let matches = this.extractMatches(data);
                if (matches.length > 0) {
                    return matches;
                }
            } catch (e) { /* silenced */ }

            // Strategy A: JSON FDSearch (Standard envelope)
            try {
                const data = await this.request("POST", `/ISAPI/Intelligent/FDLib/FDSearch?format=json`, {
                    FDSearchDescription: { searchID: searchId, searchResultPosition: 0, maxResults: 100, FDID: fdid }
                }, device);
                let matches = this.extractMatches(data);
                if (matches.length > 0) {
                    return matches;
                }
            } catch (e) { /* silenced */ }

            // Strategy B: JSON FDSearch (Flat envelope)
            try {
                const data = await this.request("POST", `/ISAPI/Intelligent/FDLib/FDSearch?format=json`, {
                    searchID: searchId,
                    searchResultPosition: 0,
                    maxResults: 100,
                    fdID: fdid
                }, device);
                let matches = this.extractMatches(data);
                if (matches.length > 0) {
                    return matches;
                }
            } catch (e) { /* silenced */ }

            // Strategy C: FaceDataRecord Search (Alternative intelligent path)
            try {
                const data = await this.request("POST", "/ISAPI/Intelligent/FDLib/FaceDataRecord/Search?format=json", {
                    FaceDataSearchDescription: {
                        searchID: searchId,
                        searchResultPosition: 0,
                        maxResults: 100,
                        fdID: fdid
                    }
                }, device);
                let matches = this.extractMatches(data);
                if (matches.length > 0) {
                    return matches;
                }
            } catch (e) { /* silenced */ }
        }

        // --- PHASE 2: Access Control Search (Terminals) ---
        // Strategy L: AccessControl UserInfo Search (Standard for terminals)
        try {
            const data = await this.request("POST", "/ISAPI/AccessControl/UserInfo/Search?format=json", {
                UserInfoSearchCond: {
                    searchID: searchId,
                    searchResultPosition: 0,
                    maxResults: 100
                }
            }, device);
            let matches = this.extractMatches(data);
            if (matches.length > 0) {
                return matches;
            }
        } catch (e) { /* silenced */ }

        // --- PHASE 3: Face Record Search (Advanced modern terminals) ---
        try {
            const data = await this.request("POST", "/ISAPI/AccessControl/Face/Record/Search?format=json", {
                FaceRecordSearchCond: {
                    searchID: searchId,
                    searchResultPosition: 0,
                    maxResults: 100
                }
            }, device);
            let matches = this.extractMatches(data);
            if (matches.length > 0) {
                return matches;
            }
        } catch (e) { /* silenced */ }

        // --- PHASE 4: Bulk Listing & Fallbacks ---

        // Strategy G: GET Direct FaceDataRecordList (NVR style list)
        try {
            const data = await this.request("GET", "/ISAPI/Intelligent/FDLib/FaceDataRecordList?format=json", null, device);
            let matches = this.extractMatches(data);
            if (matches.length > 0) {
                return matches;
            }
        } catch (e) { /* silenced */ }

        // Strategy H: GET Direct FaceRecordList
        try {
            const data = await this.request("GET", "/ISAPI/Intelligent/FDLib/FaceRecordList?format=json", null, device);
            let matches = this.extractMatches(data);
            if (matches.length > 0) {
                return matches;
            }
        } catch (e) { /* silenced */ }

        // Strategy E: Direct FaceDataRecord GET
        try {
            const data = await this.request("GET", "/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json", null, device);
            let matches = this.extractMatches(data);
            if (matches.length > 0) {
                return matches;
            }
        } catch (e) { /* silenced */ }

        // Strategy F: Direct UserInfo GET (Some terminals allow simple list)
        try {
            const data = await this.request("GET", "/ISAPI/AccessControl/UserInfo?format=json", null, device);
            let matches = this.extractMatches(data);
            if (matches.length > 0) {
                return matches;
            }
        } catch (e) { /* silenced */ }

        // --- PHASE 4: XML Fallbacks (Old/Legacy/Specialized) ---
        const fdidToTry = ["1", "0"];
        for (const fdid of fdidToTry) {
            try {
                // Try Strategy 1: FDSearchDescription
                const xmlFDSearch = `<?xml version="1.0" encoding="UTF-8"?><FDSearchDescription><searchID>xml_${Date.now()}</searchID><searchResultPosition>0</searchResultPosition><maxResults>100</maxResults><FDID>${fdid}</FDID></FDSearchDescription>`;
                let xmlRes = await this.requestXML("POST", "/ISAPI/Intelligent/FDLib/FDSearch", xmlFDSearch, device).catch(() => null);

                // Try Strategy 2: FaceDataSearchDescription (ContentMgmt) - Professional Series
                if (!xmlRes || !xmlRes.includes('<name>')) {
                    const xmlFaceSearch = `<?xml version="1.0" encoding="UTF-8"?><FaceDataSearchDescription><searchID>xml_${Date.now()}</searchID><searchResultPosition>0</searchResultPosition><maxResults>100</maxResults></FaceDataSearchDescription>`;
                    xmlRes = await this.requestXML("POST", "/ISAPI/ContentMgmt/FaceDataSearch", xmlFaceSearch, device).catch(() => null);
                }

                if (xmlRes) {
                    const results = this.parseFaceXML(xmlRes);
                    if (results.length > 0) {
                        return results;
                    }
                }
            } catch (e: any) { /* silenced */ }
        }

        return [];
    }

    async getFaceImage(device: Device, faceId: string): Promise<Buffer | null> {
        // Strategy 1: Intelligent/FDLib (Cameras/NVRs)
        try {
            const url = `/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json&faceId=${faceId}`;
            const data = await this.request("GET", url, null, device);
            if (data?.FaceDataRecord?.faceData) {
                return Buffer.from(data.FaceDataRecord.faceData, 'base64');
            }
        } catch (e) { /* silenced */ }

        // Strategy 2: Access Control (Terminals/MinMoe)
        try {
            const searchUrl = `/ISAPI/AccessControl/Face/Record/Search?format=json`;
            const payload = {
                FaceRecordSearchCond: {
                    searchID: "img_" + Date.now().toString(16),
                    searchResultPosition: 0,
                    maxResults: 10,
                    employeeNo: faceId
                }
            };
            const data = await this.request("POST", searchUrl, payload, device);
            if (data?.FaceRecordSearch?.FaceRecord && Array.isArray(data.FaceRecordSearch.FaceRecord)) {
                const record = data.FaceRecordSearch.FaceRecord[0];
                if (record.faceData) return Buffer.from(record.faceData, 'base64');
            }
        } catch (e) { /* silenced */ }

        return null;
    }

    private parseFaceXML(xml: string): any[] {
        if (!xml) return [];
        // Manual regex extraction for high resilience across different XML schemas
        const rawNames = xml.match(/<name>(.*?)<\/name>/g)?.map(n => n.replace(/<\/?name>/g, '').trim()) || [];
        const rawFPIDs = xml.match(/<FPID>(.*?)<\/FPID>/g)?.map(n => n.replace(/<\/?FPID>/g, '').trim()) || [];
        const rawFaceIDs = xml.match(/<faceId>(.*?)<\/faceId>/g)?.map(n => n.replace(/<\/?faceId>/g, '').trim()) || [];
        const rawEmployeeNos = xml.match(/<employeeNo>(.*?)<\/employeeNo>/g)?.map(t => t.replace(/<\/?employeeNo>/g, '').trim()) || [];

        const results: any[] = [];
        const maxLen = Math.max(rawNames.length, rawFPIDs.length, rawFaceIDs.length, rawEmployeeNos.length);

        for (let i = 0; i < maxLen; i++) {
            const fpid = rawFPIDs[i] || rawFaceIDs[i] || rawEmployeeNos[i] || `PID-${i}`;
            if (fpid && fpid !== '0') {
                results.push({
                    FPID: fpid,
                    employeeNo: rawEmployeeNos[i] || fpid,
                    name: rawNames[i] || `Hard-ID ${fpid}`,
                    faceURL: "" // Content retrieval requires separate call, but we have the ID now
                });
            }
        }
        return results;
    }

    private extractMatches(data: any): any[] {
        if (!data) return [];

        // Recursive search for arrays that likely contain records
        const findRecordArray = (obj: any): any[] | null => {
            if (!obj || typeof obj !== 'object') return null;

            // Priority keys for face/user records
            const keys = [
                "MatchList", "matchList",
                "UserInfo", "userInfo",
                "FaceDataRecord", "faceDataRecord",
                "FaceInfo", "faceInfo",
                "FaceRecord", "faceRecord",
                "UserInfoList", "userInfoList"
            ];
            for (const key of keys) {
                if (Array.isArray(obj[key])) return obj[key];
                // Sometimes it's nested like data.UserInfoList.UserInfo
                if (obj[key] && typeof obj[key] === 'object') {
                    for (const subKey of keys) {
                        if (Array.isArray(obj[key][subKey])) return obj[key][subKey];
                    }
                }
            }

            // Check nested objects (limit depth to avoid infinite loops)
            for (const k in obj) {
                if (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k]) && k !== 'httpsAgent') {
                    const found = findRecordArray(obj[k]);
                    if (found) return found;
                }
            }
            return null;
        };

        const matches = findRecordArray(data);
        if (matches) {
            return matches;
        }

        return [];
    }

    async getDoorlog(device: Device, num: number = 50, offset: number = 0): Promise<any[]> {
        // Mode 1: Access Control Search (Terminals)
        try {
            const payload = {
                AcsEventSearchDescription: {
                    searchID: "log_" + Date.now().toString(16).slice(-8),
                    searchResultPosition: offset,
                    maxResults: num,
                    major: 0,
                    minor: 0
                }
            };
            const data = await this.request("POST", "/ISAPI/AccessControl/AcsEvent?format=json", payload, device);
            if (data?.AcsEventSearch?.AcsEvent) {
                return data.AcsEventSearch.AcsEvent.map((item: any) => ({
                    ID: item.serialNo,
                    Name: item.name || item.employeeNoString || "Acceso Hardware",
                    Date: item.time?.split('T')[0] || "",
                    Time: item.time?.split('T')[1]?.split('.')[0] || "",
                    Detail: item.currentVerifyMode || "Verificado"
                }));
            }
        } catch (e: any) {
            console.warn(`[Hikvision Log] Access Control strategy failed: ${e.message}`);
        }

        // Mode 2: LPR Audit Search (ANPR Cameras)
        try {
            // We use requestXML because searchLPListAudit often requires direct XML
            const xml = `<?xml version="1.0" encoding="UTF-8"?><LPSearchCond><searchID>${Date.now()}</searchID><maxResult>${num}</maxResult><searchResultPosition>${offset}</searchResultPosition></LPSearchCond>`;
            const res = await this.requestXML("POST", "/ISAPI/Traffic/channels/1/searchLPListAudit", xml, device);

            const rawPlates = res.match(/<licensePlate>(.*?)<\/licensePlate>/g)?.map(n => n.replace(/<\/?licensePlate>/g, '')) || [];
            const rawTimes = res.match(/<absTime>(.*?)<\/absTime>/g)?.map(n => n.replace(/<\/?absTime>/g, '')) || [];

            return rawPlates.map((plate, i) => ({
                ID: `LPR-${i}`,
                Name: plate,
                Date: rawTimes[i]?.split('T')[0] || "",
                Time: rawTimes[i]?.split('T')[1]?.split('Z')[0] || "",
                Detail: "Detección LPR"
            }));
        } catch (e: any) {
            console.error(`[Hikvision Log] LPR strategy failed: ${e.message}`);
        }

        return [];
    }

    private getNumericId(stringId: string): string {
        let hash = 0;
        for (let i = 0; i < stringId.length; i++) {
            const char = stringId.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash % 1000000).toString();
    }

    async syncUserWithFace(user: any, device: Device): Promise<void> {

        // Generate a 4-7 digit EmployeeNo from the DB ID
        const employeeNo = this.getNumericId(user.id);

        // 1. Create/Update User Info
        const userPayload = {
            UserInfo: {
                employeeNo: employeeNo,
                name: user.name,
                userType: "normal",
                Valid: {
                    enable: true,
                    beginTime: "2024-01-01T00:00:00",
                    endTime: "2037-12-31T23:59:59"
                },
                doorRight: "1",
                RightPlan: [{ doorNo: 1, planTemplateNo: "1" }]
            }
        };

        try {
            await this.request("POST", "/ISAPI/AccessControl/UserInfo/Record?format=json", userPayload, device);
        } catch (e: any) {
            await this.request("PUT", "/ISAPI/AccessControl/UserInfo/Modify?format=json", userPayload, device).catch(() => { });
        }

        // 2. Sync Card (if any TAG)
        const tag = user.credentials?.find((c: any) => c.type === 'TAG');
        if (tag) {
            const cardPayload = {
                CardInfo: {
                    employeeNo: employeeNo,
                    cardNo: tag.value,
                    cardType: "normalCard"
                }
            };
            try {
                await this.request("POST", "/ISAPI/AccessControl/CardInfo/Record?format=json", cardPayload, device);
            } catch (e) {
                await this.request("PUT", "/ISAPI/AccessControl/CardInfo/Modify?format=json", cardPayload, device).catch(() => { });
            }
        }

        // 3. Sync Face Image
        if (user.cara) {
            try {
                let imageBuffer: Buffer | null = null;
                if (user.cara.startsWith("http")) {
                    const resp = await axios.get(user.cara, { responseType: 'arraybuffer', timeout: 5000 });
                    imageBuffer = Buffer.from(resp.data);
                }

                if (imageBuffer) {
                    const base64Face = imageBuffer.toString('base64');
                    const facePayload = {
                        faceId: employeeNo,
                        faceData: base64Face
                    };
                    // URI variation: modern terminals use /ISAPI/AccessControl/Face/Record
                    await this.request("POST", "/ISAPI/AccessControl/Face/Record?format=json", {
                        FaceInfo: {
                            employeeNo: employeeNo,
                            faceData: base64Face
                        }
                    }, device).catch(async () => {
                        // Legacy/Snapshot variation
                        await this.request("POST", "/ISAPI/AccessControl/Snapshot/Face?format=json", {
                            employeeNo: employeeNo,
                            faceData: base64Face
                        }, device).catch(e => console.error("Final face sync failure", e.message));
                    });
                }
            } catch (e: any) {
                console.error(`[Hikvision Sync] Face image download/sync failed:`, e.message);
            }
        }
    }
}
