/**
 * IVS (líneas/zonas) de NVR Dahua vía configManager (VideoAnalyseRule).
 * Coords Dahua: 0–8192, ORIGEN ARRIBA-IZQUIERDA. Se exponen en la MISMA convención que
 * el driver Hik (0–1000, origen ABAJO-IZQUIERDA) para que el calibrador del cliente
 * funcione igual sin lógica por marca.
 *
 *   API (0–1000, abajo-izq)  ↔  Dahua (0–8192, arriba-izq)
 *   x_d = x_api/1000*8192          x_api = x_d/8192*1000
 *   y_d = (1000 - y_api)/1000*8192 y_api = 1000 - y_d/8192*1000
 */
import { authenticatedRequest } from "@/lib/digest-auth";

export interface DahuaConn { ip: string; user: string; pass: string; }
export type Pt = { x: number; y: number };

const dev = (c: DahuaConn) => ({ ip: c.ip, username: c.user, password: c.pass, authType: "DIGEST" });
const D = 8192;
const toApi = (xd: number, yd: number): Pt => ({ x: Math.round((xd / D) * 1000), y: Math.round(1000 - (yd / D) * 1000) });
const toDahua = (p: Pt) => ({ x: Math.max(0, Math.min(D, Math.round((p.x / 1000) * D))), y: Math.max(0, Math.min(D, Math.round(((1000 - p.y) / 1000) * D))) });

async function get(c: DahuaConn, name: string): Promise<string> {
    return authenticatedRequest("GET", `/cgi-bin/configManager.cgi?action=getConfig&name=${name}`, dev(c), { responseType: "text", timeout: 9000 });
}
async function setCfg(c: DahuaConn, query: string): Promise<string> {
    return authenticatedRequest("GET", `/cgi-bin/configManager.cgi?action=setConfig&${query}`, dev(c), { responseType: "text", timeout: 9000 });
}

/** Parsea el bloque de reglas de un canal (0-based) y extrae línea/zona. */
function parseChannel(txt: string, chIdx: number) {
    const rules: Record<number, { type?: string; region: Record<number, Pt>; line: Record<number, Pt> }> = {};
    const re = new RegExp(`VideoAnalyseRule\\[${chIdx}\\]\\[(\\d+)\\]\\.(Type|Config\\.DetectRegion\\[(\\d+)\\]\\[(\\d)\\]|Config\\.DetectLine\\[(\\d+)\\]\\[(\\d)\\])=([^\\r\\n]*)`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt))) {
        const r = parseInt(m[1], 10);
        rules[r] ||= { region: {}, line: {} };
        const field = m[2];
        const val = (m[7] || "").trim();
        if (field === "Type") rules[r].type = val;
        else if (field.startsWith("Config.DetectRegion")) {
            const k = parseInt(m[3], 10), axis = m[4];
            rules[r].region[k] ||= { x: 0, y: 0 };
            if (axis === "0") rules[r].region[k].x = parseInt(val, 10) || 0; else rules[r].region[k].y = parseInt(val, 10) || 0;
        } else if (field.startsWith("Config.DetectLine")) {
            const k = parseInt(m[5], 10), axis = m[6];
            rules[r].line[k] ||= { x: 0, y: 0 };
            if (axis === "0") rules[r].line[k].x = parseInt(val, 10) || 0; else rules[r].line[k].y = parseInt(val, 10) || 0;
        }
    }
    return rules;
}

function findRule(rules: ReturnType<typeof parseChannel>, type: string): number | null {
    for (const r of Object.keys(rules)) { if (rules[+r].type === type) return +r; }
    return null;
}
function ptsFrom(obj: Record<number, Pt>): Pt[] {
    return Object.keys(obj).map(Number).sort((a, b) => a - b).map((k) => obj[k]);
}

export async function readDahuaIvs(c: DahuaConn, channel: number): Promise<{ support: { line: boolean; field: boolean }; line: Pt[]; field: Pt[] }> {
    const chIdx = channel - 1;
    let txt = "";
    try { txt = await get(c, "VideoAnalyseRule"); } catch { return { support: { line: false, field: false }, line: [], field: [] }; }
    const rules = parseChannel(txt, chIdx);
    const rLine = findRule(rules, "CrossLineDetection");
    const rField = findRule(rules, "CrossRegionDetection");
    const line = rLine != null ? ptsFrom(rules[rLine].line).map((p) => toApi(p.x, p.y)) : [];
    const field = rField != null ? ptsFrom(rules[rField].region).map((p) => toApi(p.x, p.y)) : [];
    return { support: { line: rLine != null, field: rField != null }, line, field };
}

/** Escribe la zona (CrossRegionDetection) del canal. */
export async function writeDahuaField(c: DahuaConn, channel: number, points: Pt[]): Promise<void> {
    const chIdx = channel - 1;
    const txt = await get(c, "VideoAnalyseRule");
    const rules = parseChannel(txt, chIdx);
    let r = findRule(rules, "CrossRegionDetection");
    if (r == null) r = 0; // sin regla: usar índice 0 (Olivos ya trae una por canal)
    const dpts = points.map(toDahua);
    const parts: string[] = [];
    dpts.forEach((p, k) => {
        parts.push(`VideoAnalyseRule[${chIdx}][${r}].Config.DetectRegion[${k}][0]=${p.x}`);
        parts.push(`VideoAnalyseRule[${chIdx}][${r}].Config.DetectRegion[${k}][1]=${p.y}`);
    });
    parts.push(`VideoAnalyseRule[${chIdx}][${r}].Config.DetectRegion[${dpts.length}]=`); // trunca extras
    await setCfg(c, parts.join("&"));
}

/** Escribe la línea (CrossLineDetection) del canal (2 puntos). */
export async function writeDahuaLine(c: DahuaConn, channel: number, points: Pt[]): Promise<void> {
    const chIdx = channel - 1;
    const txt = await get(c, "VideoAnalyseRule");
    const rules = parseChannel(txt, chIdx);
    const r = findRule(rules, "CrossLineDetection");
    if (r == null) throw new Error("El canal no tiene una regla de cruce de línea configurada en el NVR.");
    const dpts = points.map(toDahua);
    const parts: string[] = [];
    dpts.forEach((p, k) => {
        parts.push(`VideoAnalyseRule[${chIdx}][${r}].Config.DetectLine[${k}][0]=${p.x}`);
        parts.push(`VideoAnalyseRule[${chIdx}][${r}].Config.DetectLine[${k}][1]=${p.y}`);
    });
    await setCfg(c, parts.join("&"));
}
