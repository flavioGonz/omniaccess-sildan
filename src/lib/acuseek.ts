/**
 * AcuSeek / AcuSearch driver (Hikvision NVR I/VPro) — búsqueda de video por lenguaje natural.
 *
 * API REAL capturado en campo (2026-09-02, DS-7732NXI-I4/VPro fw V5.05.335, AcuSeek activado):
 *  - Crear:    POST /ISAPI/ContentMgmt/AsynSearchByTextTask?format=json  (JSON PLANO)
 *              body: { startTime, endTime, channelList:[..], text, similarity, picStorageType:"localURL" }
 *              → { taskID: "uuid" }
 *  - Poll/res: POST /ISAPI/ContentMgmt/SearchTextTaskStatus?format=json
 *              body: { taskID, searchResultPosition, maxResults, similarity }
 *              → { runStatus:"working|completed", progress, numOfMatches, totalMatches,
 *                  matchResults:[{ id, time, channelID, targetType, similarity, imageUUID,
 *                                  image:{filePath}, targetImage:{filePath}, targetRect:{x,y,width,height} }] }
 *  - Borrar:   POST /ISAPI/ContentMgmt/DeleteAsynSearchByTextTask?format=json  { taskID }
 *  - Ejemplos: GET  /ISAPI/Intelligent/AcuSeek/ExampleTerms?format=json → { examplesList:[{example}] }
 * Las imágenes (image.filePath) son URLs del NVR protegidas por digest → se sirven vía /api/acuseek/image.
 */
import { authenticatedRequest } from "@/lib/digest-auth";

export interface AcuSeekDevice { ip: string; username: string; password: string; authType?: string; }
const dev = (d: AcuSeekDevice): any => ({ ip: d.ip, username: d.username, password: d.password, authType: (d.authType || "DIGEST").toUpperCase() });
const flag = (xml: string, name: string) => new RegExp(`<${name}>\\s*true\\s*</${name}>`, "i").test(xml);

export interface AcuSeekCapabilities { asyncSearchByText: boolean; searchTarget: boolean; generateText: boolean; info: boolean; authorizeParam: boolean; acuSearchCapPresent: boolean; }
export interface AcuSeekStatus { supported: boolean; activated: boolean; reason?: string; capabilities: AcuSeekCapabilities; }

export class AcuSeekNotActivatedError extends Error { activated = false; constructor(msg?: string) { super(msg || "AcuSeek no está activado en el NVR."); this.name = "AcuSeekNotActivated"; } }

/** GET /ISAPI/System/capabilities → flags AcuSeek */
export async function getAcuSeekCapabilities(device: AcuSeekDevice): Promise<AcuSeekCapabilities> {
    const xml: string = await authenticatedRequest("GET", "/ISAPI/System/capabilities", dev(device), { responseType: "text", accept: "application/xml", timeout: 10000 });
    return {
        asyncSearchByText: flag(xml, "isSupportAsynSearchByTextTask"),
        searchTarget: flag(xml, "isSupportSearchAcuSeekTarget"),
        generateText: flag(xml, "isSupportGenerateAcuSeekText"),
        info: flag(xml, "isSupportAcuSeekInfo"),
        authorizeParam: flag(xml, "isSupportAcuSeekAuthorizeParam"),
        acuSearchCapPresent: /<AcuSearchCap>/i.test(xml),
    };
}

export function isNotSupportResponse(body: any): boolean {
    const s = typeof body === "string" ? body : JSON.stringify(body || "");
    return /notSupport/i.test(s) || /Invalid Operation/i.test(s);
}

/** Sondea activación real: GET ExampleTerms responde si AcuSeek está activo; "notSupport" si no. */
export async function probeAcuSeekActivation(device: AcuSeekDevice): Promise<{ activated: boolean; reason?: string }> {
    try {
        const r = await authenticatedRequest("GET", "/ISAPI/Intelligent/AcuSeek/ExampleTerms?format=json", dev(device), { responseType: "json", accept: "application/json", timeout: 8000 });
        if (r && (r.examplesList || r.ExampleTerms)) return { activated: true };
        if (r && isNotSupportResponse(r)) return { activated: false, reason: "AcuSeek no activado (notSupport)." };
        return { activated: true }; // respondió sin error
    } catch (e: any) {
        const body = e?.response?.data;
        if (body && isNotSupportResponse(body)) return { activated: false, reason: "AcuSeek soportado por el firmware pero NO activado/licenciado en el NVR. Activar AcuSearch por canal + autorizar AcuSeek en la web del NVR." };
        if (e?.response?.status === 403) return { activated: false, reason: "Endpoints AcuSeek gateados (403). Falta activar AcuSeek en el NVR." };
        return { activated: false, reason: e?.message || "No se pudo confirmar activación." };
    }
}

export async function getAcuSeekStatus(device: AcuSeekDevice): Promise<AcuSeekStatus> {
    const capabilities = await getAcuSeekCapabilities(device);
    const supported = capabilities.asyncSearchByText || capabilities.searchTarget;
    if (!supported) return { supported: false, activated: false, reason: "Este NVR no soporta AcuSeek.", capabilities };
    const act = await probeAcuSeekActivation(device);
    return { supported: true, activated: act.activated, reason: act.reason, capabilities };
}

/** Ejemplos de consulta que sugiere el NVR */
export async function getExampleTerms(device: AcuSeekDevice): Promise<string[]> {
    try {
        const r = await authenticatedRequest("GET", "/ISAPI/Intelligent/AcuSeek/ExampleTerms?format=json", dev(device), { responseType: "json", accept: "application/json", timeout: 8000 });
        return (r?.examplesList || []).map((x: any) => x.example).filter(Boolean);
    } catch { return []; }
}

/** Búsquedas recientes que guarda el NVR */
export async function getHistoricalTerms(device: AcuSeekDevice): Promise<string[]> {
    try {
        const r = await authenticatedRequest("GET", "/ISAPI/Intelligent/AcuSeek/GetHistoricalTerms?format=json", dev(device), { responseType: "json", accept: "application/json", timeout: 8000 });
        return (r?.historicalTermsList || []).map((x: any) => x.terms).filter(Boolean);
    } catch { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────

export interface TextSearchParams { text: string; channels?: number[]; from?: string; to?: string; similarity?: number; }
export interface AcuSeekMatch { id: number; channel: number; time: string; targetType?: string; score?: number; imageUUID?: string; imagePath?: string; targetImagePath?: string; rect?: { x: number; y: number; width: number; height: number }; }

const DEFAULT_CHANNELS = Array.from({ length: 32 }, (_, i) => i + 1);

/** Crea la tarea de búsqueda por texto → taskID */
export async function createTextSearch(device: AcuSeekDevice, params: TextSearchParams): Promise<{ taskID: string }> {
    const now = new Date();
    const from = params.from || new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
    const to = params.to || now.toISOString();
    const body = {
        startTime: from,
        endTime: to,
        channelList: params.channels?.length ? params.channels : DEFAULT_CHANNELS,
        text: params.text.slice(0, 128),
        similarity: params.similarity ?? 60,
        picStorageType: "localURL",
    };
    try {
        const r = await authenticatedRequest("POST", "/ISAPI/ContentMgmt/AsynSearchByTextTask?format=json", dev(device), { data: body, contentType: "application/json", accept: "application/json", responseType: "json", timeout: 20000 });
        const taskID = r?.taskID || r?.taskId;
        if (!taskID) throw new Error("El NVR no devolvió taskID: " + JSON.stringify(r).slice(0, 200));
        return { taskID };
    } catch (e: any) {
        if (isNotSupportResponse(e?.response?.data) || e?.response?.status === 403) throw new AcuSeekNotActivatedError();
        throw new Error(e?.response?.data?.errorMsg || e?.message || "Error creando búsqueda AcuSeek");
    }
}

export interface TaskStatus { status: "working" | "completed" | "error"; progress: number; totalMatches: number; matches: AcuSeekMatch[]; }

/** Poll + resultados de la tarea */
export async function getTextSearchStatus(device: AcuSeekDevice, taskID: string, opts?: { position?: number; maxResults?: number; similarity?: number }): Promise<TaskStatus> {
    const body = { taskID, searchResultPosition: opts?.position ?? 1, maxResults: opts?.maxResults ?? 50, similarity: opts?.similarity ?? 0 };
    try {
        const r = await authenticatedRequest("POST", "/ISAPI/ContentMgmt/SearchTextTaskStatus?format=json", dev(device), { data: body, contentType: "application/json", accept: "application/json", responseType: "json", timeout: 20000 });
        const run = (r?.runStatus || "working").toLowerCase();
        const status: TaskStatus["status"] = run.includes("complet") ? "completed" : run.includes("err") ? "error" : "working";
        const matches: AcuSeekMatch[] = (r?.matchResults || []).map((m: any) => ({
            id: m.id,
            channel: m.channelID,
            time: m.time,
            targetType: m.targetType,
            score: m.similarity,
            imageUUID: m.imageUUID,
            imagePath: decodeAmp(m.image?.filePath),
            targetImagePath: decodeAmp(m.targetImage?.filePath),
            rect: m.targetRect,
        }));
        return { status, progress: r?.progress ?? 0, totalMatches: r?.totalMatches ?? matches.length, matches };
    } catch (e: any) {
        if (isNotSupportResponse(e?.response?.data) || e?.response?.status === 403) throw new AcuSeekNotActivatedError();
        throw new Error(e?.response?.data?.errorMsg || e?.message || "Error consultando resultados AcuSeek");
    }
}

export async function deleteTextSearch(device: AcuSeekDevice, taskID: string): Promise<void> {
    try { await authenticatedRequest("POST", "/ISAPI/ContentMgmt/DeleteAsynSearchByTextTask?format=json", dev(device), { data: { taskID }, contentType: "application/json", accept: "application/json", responseType: "json", timeout: 10000 }); } catch { /* best-effort */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// AcuSearch — búsqueda por IMAGEN / objetivo (humanRecognition/searchByPic). Protocolo verificado E2E 2026-09-02.
// Spec: ISAPI_DVR_Pro Series With AcuSense.pdf §12.6.1 + formato multipart de FDLib/searchByPic.
//  POST /ISAPI/Intelligent/humanRecognition/searchByPic?format=json  (multipart/form-data)
//    parte 1: name=""            Content-Type: application/json  {dataType:"binary", startTime, endTime, similarity(0-1), maxResults, Rect, [channelID:"N"]}
//    parte 2: name="Picture_Name" Content-Length + Content-Type: image/jpeg + bytes
//    → {taskID}.  OMITIR channelID = todos los canales.
//  GET  .../searchByPic/progress?format=json&taskID=  → {progress, matchePicNums}
//  POST .../searchByPic/result?format=json {taskID, searchResultPosition, maxResults} → {targetInfo[], totalMatches, responseStatusStrg}
// ─────────────────────────────────────────────────────────────────────────────

export type ImageEngine = "human" | "vehicle";
export interface ImageSearchParams { from?: string; to?: string; similarity?: number; maxResults?: number; channelID?: number | string; rect?: { x: number; y: number; width: number; height: number }; engine?: ImageEngine; }
/** Paths por motor. Ambos verificados E2E (vehicle 2026-09-03, extraído del chunk 3147 del web UI del NVR).
 *  VEHICLE difiere del humano: multipart parte `vehicleInfo` (JSON {vehicleInfo:{startTime,endTime,Rect,channels:[int]}}) + parte `vehicleImage` (jpeg);
 *  NO lleva dataType/similarity/maxResults; el rango NO puede exceder 7 días (timeRangeCannotExceed7Days); progress/result por path /async/progress/{task}, /async/result/{task} (POST body {taskID,searchResultPosition,maxResults}). */
const VEHICLE_MAX_RANGE_MS = 7 * 24 * 3600 * 1000;
const ENGINE = {
    human: { create: "/ISAPI/Intelligent/humanRecognition/searchByPic?format=json", progress: (t: string) => `/ISAPI/Intelligent/humanRecognition/searchByPic/progress?format=json&taskID=${encodeURIComponent(t)}`, result: () => "/ISAPI/Intelligent/humanRecognition/searchByPic/result?format=json", del: (t: string) => `/ISAPI/Intelligent/humanRecognition/searchByPic?format=json&taskID=${encodeURIComponent(t)}` },
    vehicle: { create: "/ISAPI/Intelligent/vehicleRecognition/searchByPic/async?format=json", progress: (t: string) => `/ISAPI/Intelligent/vehicleRecognition/searchByPic/async/progress/${encodeURIComponent(t)}?format=json`, result: (t?: string) => `/ISAPI/Intelligent/vehicleRecognition/searchByPic/async/result/${encodeURIComponent(t || "")}?format=json`, del: (t: string) => `/ISAPI/Intelligent/vehicleRecognition/searchByPic/async?format=json&taskID=${encodeURIComponent(t)}` },
};
export interface ImageMatch { id: number; channel: number; deviceName?: string; time: string; score?: number; imagePath?: string; targetImagePath?: string; rect?: { x: number; y: number; width: number; height: number }; targetID?: number; attrs?: Record<string, string>; }

/** Crea una búsqueda por imagen. `image` = JPEG buffer de referencia. Devuelve el taskID que genera el NVR. */
export async function createImageSearch(device: AcuSeekDevice, image: Buffer, params: ImageSearchParams = {}): Promise<{ taskID: string }> {
    const now = new Date();
    let from = params.from || new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
    const to = params.to || now.toISOString();
    const engine: ImageEngine = params.engine || "human";
    const rect = params.rect || { x: 0, y: 0, width: 1, height: 1 };
    const hasCh = params.channelID != null && params.channelID !== "" && params.channelID !== "ALL";

    const boundary = "----OmniAcuSearch" + Date.now().toString(16);
    let head: Buffer;
    if (engine === "vehicle") {
        // el NVR rechaza rangos > 7 días → recortar por el inicio
        if (new Date(to).getTime() - new Date(from).getTime() > VEHICLE_MAX_RANGE_MS) from = new Date(new Date(to).getTime() - VEHICLE_MAX_RANGE_MS + 1000).toISOString();
        const meta = { vehicleInfo: { startTime: from, endTime: to, Rect: rect, channels: hasCh ? [Number(params.channelID)] : DEFAULT_CHANNELS } };
        head = Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="vehicleInfo"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}` +
            `\r\n--${boundary}\r\nContent-Disposition: form-data; name="vehicleImage"; filename="target.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
        );
    } else {
        const meta: any = {
            dataType: "binary",
            startTime: from,
            endTime: to,
            similarity: Math.max(0, Math.min(1, params.similarity ?? 0.6)),
            maxResults: Math.min(1000, params.maxResults ?? 100),
            Rect: rect,
        };
        if (hasCh) meta.channelID = String(params.channelID);
        head = Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name=""\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}` +
            `\r\n--${boundary}\r\nContent-Disposition: form-data; name="Picture_Name"\r\nContent-Length: ${image.length}\r\nContent-Type: image/jpeg\r\n\r\n`
        );
    }
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, image, tail]);

    const eng = ENGINE[engine];
    try {
        const r = await authenticatedRequest("POST", eng.create, dev(device), {
            data: body, contentType: `multipart/form-data; boundary=${boundary}`, accept: "application/json", responseType: "json", timeout: 45000,
        });
        const taskID = r?.taskID;
        if (!taskID) throw new Error(r?.errorMsg || "El NVR no devolvió taskID: " + JSON.stringify(r).slice(0, 200));
        return { taskID };
    } catch (e: any) {
        const d = e?.response?.data;
        if (isNotSupportResponse(d) || e?.response?.status === 403) throw new AcuSeekNotActivatedError("AcuSearch no disponible en el NVR.");
        throw new Error(d?.errorMsg || e?.message || "Error creando búsqueda por imagen");
    }
}

export async function getImageSearchProgress(device: AcuSeekDevice, taskID: string, engine: ImageEngine = "human"): Promise<{ progress: number; matches: number }> {
    const r = await authenticatedRequest("GET", ENGINE[engine].progress(taskID), dev(device), { responseType: "json", accept: "application/json", timeout: 10000 });
    return { progress: Number(r?.progress ?? 0), matches: Number(r?.matchePicNums ?? 0) };
}

export async function getImageSearchResults(device: AcuSeekDevice, taskID: string, position = 0, maxResults = 100, engine: ImageEngine = "human"): Promise<{ matches: ImageMatch[]; total: number; more: boolean }> {
    const r = await authenticatedRequest("POST", ENGINE[engine].result(taskID), dev(device), {
        data: { taskID, searchResultPosition: position, maxResults }, contentType: "application/json", accept: "application/json", responseType: "json", timeout: 20000,
    });
    const list: any[] = r?.targetInfo || [];
    const ATTRS = ["gender", "glass", "ageGroup", "ride", "bag", "jacketColor", "direction", "speed", "targetSize",
        "vehicleType", "vehicleColor", "plateType", "plateColor", "vehicleHead", "sunroof", "luggageRack", "spareTire", "pilotSafebelt", "uphone"];
    const matches: ImageMatch[] = list.map((t, i) => {
        const attrs: Record<string, string> = {};
        for (const k of ATTRS) if (t[k] && t[k] !== "unknown" && t[k] !== "unrecognized") attrs[k] = t[k];
        return {
            id: t.targetID ?? position + i,
            channel: Number(t.monitorPointIndexCode),
            deviceName: t.monitorPointName,
            time: t.captureTime,
            score: t.similarity != null ? Math.round(Number(t.similarity) * 100) : undefined,
            imagePath: decodeAmp(t.picUrl),
            targetImagePath: decodeAmp(t.subPicUrl),
            rect: t.targetRect,
            targetID: t.targetID,
            attrs: Object.keys(attrs).length ? attrs : undefined,
        };
    });
    return { matches, total: Number(r?.totalMatches ?? matches.length), more: r?.responseStatusStrg === "MORE" };
}

export async function deleteImageSearch(device: AcuSeekDevice, taskID: string, engine: ImageEngine = "human"): Promise<void> {
    try { await authenticatedRequest("DELETE", ENGINE[engine].del(taskID), dev(device), { responseType: "json", accept: "application/json", timeout: 10000 }); } catch { /* best-effort */ }
}

/** Baja una imagen del NVR (digest) como buffer, para el proxy /api/acuseek/image */
export async function fetchAcuSeekImage(device: AcuSeekDevice, url: string): Promise<{ buf: Buffer; contentType: string }> {
    const u = new URL(url);
    const path = u.pathname + u.search;
    const data = await authenticatedRequest("GET", path, dev(device), { responseType: "arraybuffer", accept: "image/jpeg", timeout: 15000 });
    return { buf: Buffer.from(data), contentType: "image/jpeg" };
}

function decodeAmp(s?: string): string | undefined { return s ? s.replace(/&amp;/g, "&") : undefined; }
