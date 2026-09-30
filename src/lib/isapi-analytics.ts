/**
 * ISAPI Smart analytics — cruce de línea (LineDetection) e intrusión (FieldDetection).
 * Lectura no destructiva + escritura read-modify-write (se reenvía el propio XML del
 * equipo con la geometría/enabled cambiados, para no romper campos que no tocamos).
 *
 * Coordenadas Hikvision: 0–1000, ORIGEN ABAJO-IZQUIERDA. La UI invierte Y para dibujar
 * sobre el video (y_pantalla = 1000 - y). Acá se guardan/leen tal cual (sin invertir).
 */
import { authenticatedRequest } from "@/lib/digest-auth";

export interface CamDev { ip: string; username?: string | null; password?: string | null; authType?: string | null; }
const dv = (d: CamDev): CamDev => ({ ...d, authType: d.authType || "DIGEST" });
export type Pt = { x: number; y: number };

const pathLine = (ch: number) => `/ISAPI/Smart/LineDetection/${ch}`;
const pathField = (ch: number) => `/ISAPI/Smart/FieldDetection/${ch}`;

async function get(d: CamDev, p: string): Promise<string> {
    return authenticatedRequest("GET", p, dv(d), { responseType: "text", accept: "application/xml", timeout: 8000 });
}
async function put(d: CamDev, p: string, body: string): Promise<string> {
    return authenticatedRequest("PUT", p, dv(d), { data: body, contentType: "application/xml", responseType: "text", timeout: 9000 });
}

export async function getSmartSupport(d: CamDev): Promise<{ line: boolean; field: boolean }> {
    try {
        const xml = await get(d, "/ISAPI/Smart/capabilities");
        return {
            line: /<isSupportLineDetection>\s*true/i.test(xml),
            field: /<isSupportFieldDetection>\s*true/i.test(xml),
        };
    } catch { return { line: false, field: false }; }
}

function parsePoints(block: string): Pt[] {
    const pts: Pt[] = [];
    const re = /<positionX>\s*(\d+)\s*<\/positionX>\s*<positionY>\s*(\d+)\s*<\/positionY>/gi;
    let m; while ((m = re.exec(block))) pts.push({ x: parseInt(m[1], 10), y: parseInt(m[2], 10) });
    return pts;
}
function isEnabled(xml: string): boolean { return /<enabled>\s*true/i.test(xml.split(/<\/?\w+RegionList/i)[0] || xml); }

export type AnalyticRead = { supported: boolean; enabled: boolean; points: Pt[]; raw?: string };

export async function readLine(d: CamDev, ch = 1): Promise<AnalyticRead> {
    try {
        const xml = await get(d, pathLine(ch));
        if (/notSupport|Invalid Operation/i.test(xml)) return { supported: false, enabled: false, points: [] };
        // primera lista de coordenadas (la línea = 2 puntos)
        const list = xml.match(/<CoordinatesList[\s\S]*?<\/CoordinatesList>/i)?.[0] || xml;
        return { supported: true, enabled: isEnabled(xml), points: parsePoints(list), raw: xml };
    } catch { return { supported: false, enabled: false, points: [] }; }
}

export async function readField(d: CamDev, ch = 1): Promise<AnalyticRead> {
    try {
        const xml = await get(d, pathField(ch));
        if (/notSupport|Invalid Operation/i.test(xml)) return { supported: false, enabled: false, points: [] };
        const list = xml.match(/<RegionCoordinatesList[\s\S]*?<\/RegionCoordinatesList>/i)?.[0] || xml;
        return { supported: true, enabled: isEnabled(xml), points: parsePoints(list), raw: xml };
    } catch { return { supported: false, enabled: false, points: [] }; }
}

const clamp = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));

function setEnabled(xml: string, on: boolean): string {
    return xml.replace(/<enabled>\s*(true|false)\s*<\/enabled>/i, `<enabled>${on ? "true" : "false"}</enabled>`);
}
function replaceFirstCoords(xml: string, listTag: string, inner: string): string {
    const re = new RegExp(`(<${listTag}[^>]*>)([\\s\\S]*?)(<\\/${listTag}>)`, "i");
    return xml.replace(re, (_f, o, _m, c) => `${o}${inner}${c}`);
}

/** Escribe la línea (2 puntos) por read-modify-write. */
export async function writeLine(d: CamDev, ch: number, data: { enabled: boolean; points: Pt[] }): Promise<void> {
    let xml = await get(d, pathLine(ch));
    xml = setEnabled(xml, data.enabled);
    const inner = data.points.map((p) => `<Coordinates><positionX>${clamp(p.x)}</positionX><positionY>${clamp(p.y)}</positionY></Coordinates>`).join("");
    xml = replaceFirstCoords(xml, "CoordinatesList", inner);
    await put(d, pathLine(ch), xml);
}

/** Escribe la zona de intrusión (polígono) por read-modify-write. */
export async function writeField(d: CamDev, ch: number, data: { enabled: boolean; points: Pt[] }): Promise<void> {
    let xml = await get(d, pathField(ch));
    xml = setEnabled(xml, data.enabled);
    const inner = data.points.map((p) => `<RegionCoordinates><positionX>${clamp(p.x)}</positionX><positionY>${clamp(p.y)}</positionY></RegionCoordinates>`).join("");
    xml = replaceFirstCoords(xml, "RegionCoordinatesList", inner);
    await put(d, pathField(ch), xml);
}
