/**
 * ISAPI camera helper — lectura y ajuste de parámetros de imagen/ANPR
 * relevantes para detección de matrículas (Hikvision). Read-modify-write
 * sobre el XML del propio equipo (preserva el resto de campos).
 *
 * Usado por /api/devices/camera-config y /api/devices/auto-calibrate.
 */
import { authenticatedRequest } from "@/lib/digest-auth";

export interface CamDevice {
    ip: string;
    username?: string | null;
    password?: string | null;
    authType?: string | null;
}

function dev(d: CamDevice): CamDevice {
    // Hikvision LPR autentica por DIGEST; forzamos si viene vacío
    return { ...d, authType: d.authType || "DIGEST" };
}

/** Extrae el texto interno del primer <tag>...</tag> */
export function xmlField(xml: string, tag: string): string | null {
    const m = xml.match(new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`, "i"));
    return m ? m[1].trim() : null;
}

/** Reemplaza el texto interno del primer <tag>...</tag> preservando el resto */
export function setXmlField(xml: string, tag: string, val: string | number): string {
    const re = new RegExp(`(<${tag}>)\\s*[^<]*?\\s*(</${tag}>)`, "i");
    if (re.test(xml)) return xml.replace(re, `$1${val}$2`);
    return xml; // tag ausente: no forzamos (evita romper el schema del equipo)
}

async function get(d: CamDevice, path: string, timeout = 6000): Promise<string> {
    return authenticatedRequest("GET", path, dev(d), { responseType: "text", accept: "application/xml", timeout });
}
async function put(d: CamDevice, path: string, body: string, timeout = 8000): Promise<string> {
    return authenticatedRequest("PUT", path, dev(d), { data: body, contentType: "application/xml", responseType: "text", timeout });
}

const CH = "/ISAPI/Image/channels/1";

/** Lee toda la config ANPR-relevante y la normaliza a JSON */
export async function readCamConfig(d: CamDevice) {
    const out: any = {};
    const jobs: Promise<void>[] = [];
    const safe = (fn: () => Promise<void>) => jobs.push(fn().catch(() => {}));

    let exposureXml = "", shutterXml = "", gainXml = "", wdrXml = "", hlcXml = "",
        ircutXml = "", slXml = "", sharpXml = "", blcXml = "", focusXml = "", anprXml = "";

    safe(async () => { exposureXml = await get(d, `${CH}/exposure`); });
    safe(async () => { shutterXml = await get(d, `${CH}/Shutter`); });
    safe(async () => { gainXml = await get(d, `${CH}/Gain`); });
    safe(async () => { wdrXml = await get(d, `${CH}/WDR`); });
    safe(async () => { hlcXml = await get(d, `${CH}/HLC`); });
    safe(async () => { ircutXml = await get(d, `${CH}/ircutFilter`); });
    safe(async () => { slXml = await get(d, `${CH}/SupplementLight`); });
    safe(async () => { sharpXml = await get(d, `${CH}/sharpness`); });
    safe(async () => { blcXml = await get(d, `${CH}/BLC`); });
    safe(async () => { focusXml = await get(d, `${CH}/focusConfiguration`); });
    safe(async () => { anprXml = await get(d, `/ISAPI/Traffic/channels/1/vehicleDetect`); });

    await Promise.all(jobs);

    out.shutter = xmlField(shutterXml, "ShutterLevel");
    out.gain = num(xmlField(gainXml, "GainLevel"));
    out.exposureType = xmlField(exposureXml, "ExposureType");
    out.overexpose = xmlField(exposureXml, "enabled") === "true";
    out.overexposeLevel = num(xmlField(exposureXml, "hightLightDistanceLevel"));
    out.wdr = xmlField(wdrXml, "mode"); // open | close
    out.wdrLevel = num(xmlField(wdrXml, "WDRLevel"));
    out.hlc = xmlField(hlcXml, "enabled") === "true";
    out.hlcLevel = num(xmlField(hlcXml, "HLCLevel"));
    out.ircut = xmlField(ircutXml, "IrcutFilterType"); // auto|day|night|schedule
    out.supplementLight = xmlField(slXml, "supplementLightMode"); // irLight|colorVuWhiteLight|mixedLight|close
    out.sharpness = num(xmlField(sharpXml, "SharpnessLevel"));
    out.blc = xmlField(blcXml, "enabled") === "true";
    out.focusStyle = xmlField(focusXml, "focusStyle"); // AUTOMATIC|SEMIAUTOMATIC|MANUAL
    out.anprRoad = anprXml ? (anprXml.match(/<type[^>]*>\s*([^<]+?)\s*<\/type>/i)?.[1]?.trim() || null) : null;
    out.anprNation = xmlField(anprXml, "nation");
    out._raw = { exposureXml, shutterXml, gainXml, wdrXml, hlcXml, ircutXml, slXml, sharpXml, focusXml, anprXml };
    return out;
}

function num(v: string | null): number | null { if (v == null) return null; const n = parseInt(v, 10); return isNaN(n) ? null : n; }

/** Setters individuales (read-modify-write) */
export async function setShutter(d: CamDevice, level: string) {
    let xml = await get(d, `${CH}/Shutter`);
    xml = setXmlField(xml, "ShutterLevel", level);
    return put(d, `${CH}/Shutter`, xml);
}
export async function setGain(d: CamDevice, level: number) {
    let xml = await get(d, `${CH}/Gain`);
    xml = setXmlField(xml, "GainLevel", level);
    return put(d, `${CH}/Gain`, xml);
}
export async function setWDR(d: CamDevice, mode: "open" | "close", level = 50) {
    let xml = await get(d, `${CH}/WDR`);
    xml = setXmlField(setXmlField(xml, "mode", mode), "WDRLevel", level);
    return put(d, `${CH}/WDR`, xml);
}
export async function setHLC(d: CamDevice, enabled: boolean, level = 50) {
    let xml = await get(d, `${CH}/HLC`);
    xml = setXmlField(setXmlField(xml, "enabled", enabled ? "true" : "false"), "HLCLevel", level);
    return put(d, `${CH}/HLC`, xml);
}
export async function setOverexpose(d: CamDevice, enabled: boolean, level = 60) {
    let xml = await get(d, `${CH}/exposure`);
    xml = xml.replace(/(<OverexposeSuppress>[\s\S]*?<enabled>)[^<]*(<\/enabled>)/i, `$1${enabled ? "true" : "false"}$2`);
    xml = xml.replace(/(<hightLightDistanceLevel>)[^<]*(<\/hightLightDistanceLevel>)/i, `$1${level}$2`);
    return put(d, `${CH}/exposure`, xml);
}
export async function setIrcut(d: CamDevice, type: "auto" | "day" | "night" | "schedule") {
    let xml = await get(d, `${CH}/ircutFilter`);
    xml = setXmlField(xml, "IrcutFilterType", type);
    return put(d, `${CH}/ircutFilter`, xml);
}
export async function setSupplementLight(d: CamDevice, mode: string) {
    let xml = await get(d, `${CH}/SupplementLight`);
    xml = setXmlField(xml, "supplementLightMode", mode);
    return put(d, `${CH}/SupplementLight`, xml);
}
export async function setSharpness(d: CamDevice, level: number) {
    let xml = await get(d, `${CH}/sharpness`);
    xml = setXmlField(xml, "SharpnessLevel", level);
    return put(d, `${CH}/sharpness`, xml);
}
export async function setFocusStyle(d: CamDevice, style: "AUTOMATIC" | "SEMIAUTOMATIC" | "MANUAL") {
    let xml = await get(d, `${CH}/focusConfiguration`);
    xml = setXmlField(xml, "focusStyle", style);
    return put(d, `${CH}/focusConfiguration`, xml);
}
export async function setAnprRoad(d: CamDevice, type: "entrance" | "city") {
    let xml = await get(d, `/ISAPI/Traffic/channels/1/vehicleDetect`);
    xml = xml.replace(/(<RodeType>[\s\S]*?<type[^>]*>)\s*[^<]*?\s*(<\/type>)/i, `$1${type}$2`);
    return put(d, `/ISAPI/Traffic/channels/1/vehicleDetect`, xml);
}

/**
 * Perfil ANPR "barrio abierto / nocturno" — pensado para lectura de matrícula
 * con tráfico lento (20-30 km/h) y faros de frente. Cada paso es reversible.
 */
export type CalStep = { key: string; label: string; detail: string; apply: (d: CamDevice) => Promise<any> };

export const BARRIO_NIGHT_PROFILE: CalStep[] = [
    { key: "shutter", label: "Obturador 1/500", detail: "Baja de 1/1000 a 1/500: entra 2× más luz, sin blur a velocidad de barrio → patente legible de noche.", apply: (d) => setShutter(d, "1/500") },
    { key: "overexpose", label: "Anti-brillo patente ON", detail: "OverexposeSuppress activo (nivel 60): evita que los faros quemen la matrícula retrorreflectiva.", apply: (d) => setOverexpose(d, true, 60) },
    { key: "wdr", label: "WDR apagado", detail: "WDR off: el WDR mete artefactos en la lectura ANPR nocturna; se deja cerrado.", apply: (d) => setWDR(d, "close") },
    { key: "hlc", label: "HLC apagado", detail: "Highlight Compensation off por defecto; sólo se enciende manual si un carril tiene glare fuerte.", apply: (d) => setHLC(d, false) },
    { key: "gain", label: "Ganancia máx 40", detail: "Límite de ganancia a 40: sube algo la sensibilidad nocturna sin ruido que arruine el OCR.", apply: (d) => setGain(d, 40) },
    { key: "ircut", label: "Filtro IR automático", detail: "IrcutFilter en auto: de noche pasa a modo IR (la patente reflecta el infrarrojo).", apply: (d) => setIrcut(d, "auto") },
    { key: "supplement", label: "Iluminador IR auto", detail: "SupplementLight irLight/auto: enciende el IR según la luz ambiente.", apply: (d) => setSupplementLight(d, "irLight") },
    { key: "focus", label: "Foco semiautomático", detail: "focusStyle SEMIAUTOMATIC: reenfoca al cambiar de día/noche pero no 'caza' con cada auto.", apply: (d) => setFocusStyle(d, "SEMIAUTOMATIC") },
];
