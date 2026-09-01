/**
 * ISAPI ANPR region — lee y edita la "línea de captura" (región de detección de
 * matrículas) de una cámara Hikvision Traffic: carriles (Lane) + línea de
 * calibración (AboveRoadCalib), sobre /ISAPI/Traffic/channels/1/vehicleDetect.
 *
 * Coordenadas Hikvision: normalizadas 0–1000, ORIGEN ABAJO-IZQUIERDA.
 * Para dibujar sobre el video la UI invierte Y (y_screen = 1000 - y). Aquí se
 * guardan/leen tal cual las reporta el equipo (sin invertir); la inversión es
 * responsabilidad de la capa visual.
 */
import { authenticatedRequest } from "@/lib/digest-auth";

export interface AnprDevice { ip: string; username?: string | null; password?: string | null; authType?: string | null; }
const dev = (d: AnprDevice): AnprDevice => ({ ...d, authType: d.authType || "DIGEST" });
const PATH = "/ISAPI/Traffic/channels/1/vehicleDetect";

async function get(d: AnprDevice): Promise<string> {
    return authenticatedRequest("GET", PATH, dev(d), { responseType: "text", accept: "application/xml", timeout: 7000 });
}
async function put(d: AnprDevice, body: string): Promise<string> {
    return authenticatedRequest("PUT", PATH, dev(d), { data: body, contentType: "application/xml", responseType: "text", timeout: 9000 });
}

export type Pt = { x: number; y: number };
export type Lane = { laneId: number; points: Pt[] };
export interface AnprRegion { lanes: Lane[]; calib: Pt[]; roadType: string | null; nation: string | null; maxLanes: number; }

function tag(xml: string, t: string): string | null {
    const m = xml.match(new RegExp(`<${t}>\\s*([^<]*?)\\s*</${t}>`, "i"));
    return m ? m[1].trim() : null;
}

/** Extrae los pares positionX/positionY dentro de un bloque */
function parsePoints(block: string): Pt[] {
    const pts: Pt[] = [];
    const re = /<RegionCoordinates>\s*<positionX>\s*(\d+)\s*<\/positionX>\s*<positionY>\s*(\d+)\s*<\/positionY>\s*<\/RegionCoordinates>/gi;
    let m;
    while ((m = re.exec(block))) pts.push({ x: parseInt(m[1], 10), y: parseInt(m[2], 10) });
    return pts;
}

export async function readAnprRegion(d: AnprDevice): Promise<AnprRegion> {
    const xml = await get(d);
    const lanes: Lane[] = [];
    const laneRe = /<Lane>([\s\S]*?)<\/Lane>/gi;
    let lm;
    while ((lm = laneRe.exec(xml))) {
        const block = lm[1];
        const laneId = parseInt(tag(block, "laneId") || "0", 10);
        lanes.push({ laneId, points: parsePoints(block) });
    }
    let calib: Pt[] = [];
    const cm = xml.match(/<AboveRoadCalib>([\s\S]*?)<\/AboveRoadCalib>/i);
    if (cm) calib = parsePoints(cm[1]);
    const roadType = xml.match(/<RodeType>[\s\S]*?<type[^>]*>\s*([^<]+?)\s*<\/type>/i)?.[1]?.trim() || null;
    // max carriles según modo (city permite 2)
    const maxLanes = parseInt(xml.match(/<LaneList\s+size="(\d+)"/i)?.[1] || "2", 10) || 2;
    return { lanes, calib, roadType, nation: tag(xml, "nation"), maxLanes };
}

function clamp(v: number): number { return Math.max(0, Math.min(1000, Math.round(v))); }
function pointsInner(pts: Pt[]): string {
    return pts.map((p) => `<RegionCoordinates><positionX>${clamp(p.x)}</positionX><positionY>${clamp(p.y)}</positionY></RegionCoordinates>`).join("");
}

/** Reemplaza el contenido del N-ésimo <RegionCoordinatesList> (0-based) preservando su tag de apertura */
function replaceNthList(xml: string, index: number, inner: string): string {
    let i = -1;
    return xml.replace(/(<RegionCoordinatesList[^>]*>)([\s\S]*?)(<\/RegionCoordinatesList>)/gi, (full, open, _mid, close) => {
        i++;
        return i === index ? `${open}${inner}${close}` : full;
    });
}

/**
 * Escribe la región: read-modify-write. El orden documental de los
 * <RegionCoordinatesList> es [lane1, lane2, ..., calib]. Se reemplazan por índice.
 */
export async function writeAnprRegion(d: AnprDevice, data: { lanes: Lane[]; calib: Pt[] }): Promise<void> {
    let xml = await get(d);
    // Contar cuántos lists hay (numLanes + 1 calib)
    const total = (xml.match(/<RegionCoordinatesList/gi) || []).length;
    const nLaneLists = Math.max(0, total - 1); // el último es la calibración
    for (let k = 0; k < data.lanes.length && k < nLaneLists; k++) {
        xml = replaceNthList(xml, k, pointsInner(data.lanes[k].points));
    }
    if (data.calib && data.calib.length) {
        xml = replaceNthList(xml, total - 1, pointsInner(data.calib));
    }
    await put(d, xml);
}
