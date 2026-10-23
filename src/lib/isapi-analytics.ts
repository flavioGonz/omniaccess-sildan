/**
 * ISAPI Smart analytics — cruce de línea (LineDetection) e intrusión (FieldDetection).
 * Lectura no destructiva + escritura read-modify-write (se reenvía el propio XML del
 * equipo con la geometría/enabled cambiados, para no romper campos que no tocamos).
 * Cada una es una LISTA de hasta 4 reglas: el XML se interpreta en lib/analitica-xml.ts.
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
    try {
        return await authenticatedRequest("PUT", p, dv(d), { data: body, contentType: "application/xml", responseType: "text", timeout: 9000 });
    } catch (e: any) {
        // La cámara explica el rechazo en el cuerpo (ResponseStatus): sin esto sólo se veía «status code 400».
        const cuerpo = String(e?.response?.data || "");
        const sub = cuerpo.match(/<subStatusCode>\s*([^<]+?)\s*<\/subStatusCode>/i)?.[1];
        const txt = cuerpo.match(/<statusString>\s*([^<]+?)\s*<\/statusString>/i)?.[1];
        if (sub || txt) throw new Error(`La cámara rechazó el cambio: ${[txt, sub].filter(Boolean).join(" · ")}`);
        throw e;
    }
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

import { leerReglas, aplicarCambios, diferencias, validarCambios, type CambioRegla, type LecturaReglas, type ReglaCam, type TipoRegla } from "@/lib/analitica-xml";

export type AnalyticRead = { supported: boolean; enabled: boolean; points: Pt[]; raw?: string; dir?: "both" | "ab" | "ba" };

const ruta = (tipo: TipoRegla, ch: number) => (tipo === "linea" ? pathLine(ch) : pathField(ch));
const NO_SOPORTA = /notSupport|Invalid Operation/i;

/** Todas las líneas o todas las zonas de la cámara (null si no tiene esa analítica). */
export async function leerTodas(d: CamDev, tipo: TipoRegla, ch = 1): Promise<(LecturaReglas & { xml: string }) | null> {
    const xml = await get(d, ruta(tipo, ch));
    if (NO_SOPORTA.test(xml) || !/<(LineDetection|FieldDetection)\b/i.test(xml)) return null;
    return { ...leerReglas(xml, tipo), xml };
}

/**
 * Escribe los cambios de un tipo en UNA escritura (lee el XML de la cámara, cambia sólo esos
 * elementos y lo devuelve), vuelve a leer y compara: lo que devuelve son las diferencias entre lo
 * pedido y lo que la cámara guardó. Vacío = quedó exactamente así.
 */
export async function escribirTodas(d: CamDev, tipo: TipoRegla, cambios: CambioRegla[], ch = 1): Promise<{ diferencias: string[]; reglas: ReglaCam[] }> {
    if (!cambios.length) { const l = await leerTodas(d, tipo, ch); return { diferencias: [], reglas: l?.reglas || [] }; }
    const actual = await leerTodas(d, tipo, ch);
    if (!actual) throw new Error(tipo === "linea" ? "La cámara no tiene cruce de línea" : "La cámara no tiene zona de intrusión");
    const error = validarCambios(tipo, cambios, actual.max);
    if (error) throw new Error(error);
    try {
        await put(d, ruta(tipo, ch), aplicarCambios(actual.xml, tipo, cambios));
    } catch (e) {
        // Una zona borrada va sin coordenadas, como la trae la cámara de fábrica. Si algún firmware
        // no lo acepta, segundo intento: apagada y con su dibujo.
        if (tipo !== "zona" || !cambios.some((c) => c.borrar)) throw e;
        await put(d, ruta(tipo, ch), aplicarCambios(actual.xml, tipo, cambios, { conservarZona: true }));
    }
    const despues = await leerTodas(d, tipo, ch);
    const reglas = despues?.reglas || [];
    return { diferencias: diferencias(cambios, reglas), reglas };
}

/** La primera regla prendida (o, si no hay, la primera dibujada): lo que mostraban las pantallas de una sola línea. */
function primera(l: LecturaReglas | null): AnalyticRead {
    if (!l) return { supported: false, enabled: false, points: [] };
    const r = l.reglas.find((x) => x.enabled) || l.reglas.find((x) => !x.vacia);
    return { supported: true, enabled: !!r?.enabled, points: r?.points || [], dir: r?.direction };
}

export async function readLine(d: CamDev, ch = 1): Promise<AnalyticRead> {
    try { return primera(await leerTodas(d, "linea", ch)); } catch { return { supported: false, enabled: false, points: [] }; }
}
export async function readField(d: CamDev, ch = 1): Promise<AnalyticRead> {
    try { return primera(await leerTodas(d, "zona", ch)); } catch { return { supported: false, enabled: false, points: [] }; }
}

/** Compatibilidad (una sola línea): escribe o apaga la primera regla. */
export async function writeLine(d: CamDev, ch: number, data: { enabled: boolean; points: Pt[]; direction?: string }): Promise<void> {
    const l = await leerTodas(d, "linea", ch);
    const id = (l?.reglas.find((x) => x.enabled) || l?.reglas.find((x) => !x.vacia) || l?.reglas[0])?.id || 1;
    await escribirTodas(d, "linea", [data.enabled && data.points.length ? { id, points: data.points, direction: data.direction as any } : { id, enabled: false }], ch);
}
export async function writeField(d: CamDev, ch: number, data: { enabled: boolean; points: Pt[] }): Promise<void> {
    const l = await leerTodas(d, "zona", ch);
    const id = (l?.reglas.find((x) => x.enabled) || l?.reglas.find((x) => !x.vacia) || l?.reglas[0])?.id || 1;
    await escribirTodas(d, "zona", [data.enabled && data.points.length ? { id, points: data.points } : { id, enabled: false }], ch);
}
