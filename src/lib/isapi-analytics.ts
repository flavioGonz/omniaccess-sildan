/**
 * ISAPI Smart analytics — cruce de línea (LineDetection) e intrusión (FieldDetection).
 * Lectura no destructiva + escritura read-modify-write (se reenvía el propio XML del
 * equipo con la geometría/enabled cambiados, para no romper campos que no tocamos).
 * Cada una es una LISTA de hasta 4 reglas: el XML se interpreta en lib/analitica-xml.ts.
 *
 * Coordenadas Hikvision: 0–1000, ORIGEN ABAJO-IZQUIERDA. La UI invierte Y para dibujar
 * sobre el video (y_pantalla = 1000 - y). Acá se guardan/leen tal cual (sin invertir).
 */
import * as http from "http";
import crypto from "crypto";
import { hostHttp } from "@/lib/host-http";
import { exigirEscritura } from "@/lib/solo-lectura";

export interface CamDev { ip: string; username?: string | null; password?: string | null; authType?: string | null; httpPort?: number | string | null; }
export type Pt = { x: number; y: number };

const pathLine = (ch: number) => `/ISAPI/Smart/LineDetection/${ch}`;
const pathField = (ch: number) => `/ISAPI/Smart/FieldDetection/${ch}`;

async function get(d: CamDev, p: string): Promise<string> {
    // Con el mismo transporte que el PUT (sin keep-alive): un GET autenticado por axios también
    // cortaba a veces, y la relectura que verifica lo guardado no puede fallar por eso.
    // Mientras aplica un cambio de analítica la cámara corta también las lecturas: se espera y se relee.
    for (let intento = 1; ; intento++) {
        try { return await isapi(d, "GET", p); }
        catch (e) { if (!(e instanceof Corte) || intento >= 4) throw e; await new Promise((r) => setTimeout(r, 3000 * intento)); }
    }
}
/**
 * PUT a la cámara como lo hace curl, que es lo único que anduvo siempre (medido el 23/10 en una
 * Hikvision del lab, con la forma vieja morían cinco de seis escrituras con «socket hang up»):
 *  · el desafío digest se pide con un PUT VACÍO (Content-Length: 0): firmar con el desafío de un
 *    GET, o mandar el cuerpo sin autorización, hace que la cámara corte la conexión;
 *  · sin keep-alive (Node 20 reusa la conexión y la cámara ya la cerró);
 *  · Content-Length explícito: axios con cuerpo vacío no lo manda y la cámara se queda esperando.
 * Un corte se informa como CORTE: quien escribe relee la cámara antes de decidir si reintenta,
 * porque a veces la cámara aplica el cambio y recién después corta.
 */
const sinKeepAlive = new http.Agent({ keepAlive: false });
class Corte extends Error { corte = true; }
function pedido(host: string, port: number, metodo: string, ruta: string, headers: Record<string, string | number>, cuerpo?: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((ok, mal) => {
        const q = http.request({ host, port, path: ruta, method: metodo, headers, agent: sinKeepAlive, timeout: 12000 }, (r) => {
            let b = ""; r.setEncoding("utf8"); r.on("data", (c) => (b += c)); r.on("end", () => ok({ status: r.statusCode || 0, headers: r.headers, body: b })); r.on("error", (e) => mal(new Corte(e.message)));
        });
        q.on("timeout", () => { q.destroy(); mal(new Corte("la cámara no contestó a tiempo")); });
        // (12 s: la cámara tarda en contestar mientras aplica una analítica.)
        q.on("error", (e) => mal(new Corte(e.message)));
        q.end(cuerpo);
    });
}
async function put(d: CamDev, ruta: string, body: string): Promise<string> { return isapi(d, "PUT", ruta, body); }
async function isapi(d: CamDev, metodo: "GET" | "PUT" | "DELETE", ruta: string, body?: string): Promise<string> {
    exigirEscritura(d.ip || "", metodo, ruta);
    const hp = await hostHttp(d.ip || "", d.httpPort);
    const [host, puerto] = hp.split(":");
    const port = Number(puerto) || 80;
    const user = d.username || "admin", pass = d.password || "";
    const base: Record<string, string> = metodo === "PUT" ? { "Content-Type": "application/xml" } : { Accept: "application/xml" };
    let auth: Record<string, string> = {};
    if ((d.authType || "DIGEST") === "BASIC") auth = { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` };
    else {
        const reto = await pedido(host, port, metodo, ruta, metodo === "PUT" ? { ...base, "Content-Length": 0 } : base);
        const wa = reto.headers["www-authenticate"];
        if (reto.status === 401 && wa) auth = { Authorization: digest(metodo, ruta, user, pass, String(wa)) };
        else if (metodo === "GET" && reto.status < 400) return reto.body;
    }
    const r = metodo === "PUT" ? await pedido(host, port, "PUT", ruta, { ...base, ...auth, "Content-Length": Buffer.byteLength(body || "") }, body) : await pedido(host, port, metodo, ruta, { ...base, ...auth });
    if (r.status >= 400) {
        // La cámara explica el rechazo en el cuerpo (ResponseStatus): sin esto sólo se veía «status code 400».
        const sub = r.body.match(/<subStatusCode>\s*([^<]+?)\s*<\/subStatusCode>/i)?.[1];
        const txt = r.body.match(/<statusString>\s*([^<]+?)\s*<\/statusString>/i)?.[1];
        if (r.status === 401) throw new Error("La cámara rechazó el usuario o la clave");
        throw new Error(metodo !== "GET" ? `La cámara rechazó el cambio: ${[txt, sub].filter(Boolean).join(" · ") || r.status}` : `La cámara contestó ${r.status}${sub ? ` (${sub})` : ""}`);
    }
    return r.body;
}
const md5 = (t: string) => crypto.createHash("md5").update(t).digest("hex");
function digest(metodo: string, uri: string, user: string, pass: string, wa: string): string {
    const p: Record<string, string> = {};
    wa.replace(/(\w+)=(?:"([^"]*)"|([^,]*))/g, (m, k, q, v) => { p[k] = q !== undefined ? q : (v || "").trim(); return m; });
    const nc = "00000001", cnonce = crypto.randomBytes(8).toString("hex");
    const ha1 = md5(`${user}:${p.realm}:${pass}`), ha2 = md5(`${metodo}:${uri}`);
    const qop = p.qop ? p.qop.split(",")[0].trim() : "";
    const resp = qop ? md5(`${ha1}:${p.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
    let h = `Digest username="${user}", realm="${p.realm}", nonce="${p.nonce}", uri="${uri}", response="${resp}"`;
    if (p.opaque) h += `, opaque="${p.opaque}"`;
    if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    return h;
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

import { leerReglas, aplicarCambios, diferencias, validarCambios, puntoVacioDe, type CambioRegla, type LecturaReglas, type ReglaCam, type TipoRegla } from "@/lib/analitica-xml";

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
const rutaElemento = (tipo: TipoRegla, ch: number, id: number) => (tipo === "linea" ? `${pathLine(ch)}/lineItem/${id}` : `${pathField(ch)}/regions/${id}`);
const sinEspacios = (x: string) => x.replace(/\s+/g, "");
class SinRuta extends Error {}

/**
 * Escribe los cambios de un tipo y devuelve las diferencias entre lo pedido y lo que la cámara
 * guardó (vacío = quedó exactamente así).
 *
 * Elemento por elemento (…/lineItem/<id>, …/regions/<id>) y no el XML entero: probado el 23/10 en
 * «DEPO EXTERIOR» (DS-2CD2146G2-ISU, V5.7.15), el PUT del XML completo la deja ocupada y corta las
 * conexiones siguientes por minutos, y el de un solo elemento entra enseguida. Y para BORRAR:
 *  · la zona, con DELETE …/regions/<id>: por PUT no hay forma (sin coordenadas conserva las que
 *    tenía, con la lista vacía corta, con puntos repetidos da badParameters);
 *  · la línea, con PUT …/lineItem/<id> y sus dos puntos iguales (así la trae de fábrica; DELETE no
 *    está permitido).
 * El `<enabled>` de la raíz (que es el que manda) se toca al final y sólo si tiene que cambiar.
 * Si la cámara no tiene las rutas por elemento, se vuelve al XML completo.
 */
export async function escribirTodas(d: CamDev, tipo: TipoRegla, cambios: CambioRegla[], ch = 1, activa?: boolean): Promise<{ diferencias: string[]; reglas: ReglaCam[] }> {
    if (!cambios.length && activa === undefined) { const l = await leerTodas(d, tipo, ch); return { diferencias: [], reglas: l?.reglas || [] }; }
    const actual = await leerTodas(d, tipo, ch);
    if (!actual) throw new Error(tipo === "linea" ? "La cámara no tiene cruce de línea" : "La cámara no tiene zona de intrusión");
    const error = validarCambios(tipo, cambios, actual.max);
    if (error) throw new Error(error);
    const vacio = puntoVacioDe(actual.xml);
    let porElemento = true;
    for (const c of cambios) {
        if (c.borrar && actual.reglas.find((r) => r.id === c.id)?.vacia) continue;
        const listo = (l: LecturaReglas) => !diferencias([c], l.reglas).length;
        if (tipo === "zona" && c.borrar) { await conReintento(d, tipo, ch, () => isapi(d, "DELETE", rutaElemento(tipo, ch, c.id)), listo); continue; }
        if (porElemento) {
            try {
                const item = await get(d, rutaElemento(tipo, ch, c.id));
                if (!new RegExp(`<${tipo === "linea" ? "LineItem" : "FieldDetectionRegion"}\\b`, "i").test(item)) throw new SinRuta("sin ruta por elemento");
                const nuevo = aplicarCambios(item, tipo, [c], { soloElemento: true, vacio });
                if (sinEspacios(nuevo) !== sinEspacios(item)) await conReintento(d, tipo, ch, () => put(d, rutaElemento(tipo, ch, c.id), nuevo), listo);
                continue;
            } catch (e: any) {
                // Sin ruta por elemento (404/403/otro XML): se sigue con el XML completo. Un corte no es eso.
                if (e instanceof Corte || !(e instanceof SinRuta || /contestó 40[34]|rechazó el cambio: (Invalid Operation|.*notSupport|.*methodNotAllowed|404)/i.test(e?.message || ""))) throw e;
                porElemento = false;
            }
        }
        const base = await leerTodas(d, tipo, ch);
        if (!base) throw new Error("la cámara dejó de contestar la analítica");
        const nuevo = aplicarCambios(base.xml, tipo, [c]);
        if (sinEspacios(nuevo) !== sinEspacios(base.xml)) await conReintento(d, tipo, ch, () => put(d, ruta(tipo, ch), nuevo), listo);
    }
    // La raíz: prendida mientras haya algo dibujado (o lo que se pidió), apagada si no queda nada.
    const ahora = await leerTodas(d, tipo, ch);
    if (ahora) {
        const hay = ahora.reglas.some((r) => !r.vacia);
        const quiero = hay ? (activa ?? (actual.raiz || cambios.some((c) => c.points))) : false;
        if (ahora.raiz !== quiero) await conReintento(d, tipo, ch, () => put(d, ruta(tipo, ch), aplicarCambios(ahora.xml, tipo, [], { activa: quiero })), (l) => l.raiz === quiero);
    }
    const despues = await leerTodas(d, tipo, ch);
    const reglas = despues?.reglas || [];
    const dif = diferencias(cambios, reglas);
    if (activa !== undefined && despues && despues.raiz !== activa && reglas.some((r) => !r.vacia)) dif.push(`${tipo === "linea" ? "Las líneas" : "Las zonas"} quedaron ${despues.raiz ? "prendidas" : "apagadas"}`);
    return { diferencias: dif, reglas };
}

/**
 * Una escritura con su plan para cuando la cámara corta la conexión: mientras aplica un cambio de
 * analítica deja de contestar unos segundos, y a veces corta DESPUÉS de haberlo aplicado. Se espera,
 * se relee, y sólo se vuelve a mandar si no quedó (`listo` mira la cámara releída).
 */
async function conReintento(d: CamDev, tipo: TipoRegla, ch: number, escribir: () => Promise<unknown>, listo: (l: LecturaReglas) => boolean): Promise<void> {
    for (let intento = 1; ; intento++) {
        try { await escribir(); return; }
        catch (e: any) {
            if (!(e instanceof Corte)) throw e;
            await new Promise((r) => setTimeout(r, 4000 * intento));
            const ahora = await leerTodas(d, tipo, ch).catch(() => null);
            if (ahora && listo(ahora)) return;
            if (intento >= 3) throw new Error(`la cámara está ocupada (cortó la conexión ${intento} veces): probá de nuevo en un minuto`);
        }
    }
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
    if (data.enabled && data.points.length) await escribirTodas(d, "linea", [{ id, points: data.points, direction: data.direction as any }], ch);
    else await escribirTodas(d, "linea", [], ch, false);
}
export async function writeField(d: CamDev, ch: number, data: { enabled: boolean; points: Pt[] }): Promise<void> {
    const l = await leerTodas(d, "zona", ch);
    const id = (l?.reglas.find((x) => x.enabled) || l?.reglas.find((x) => !x.vacia) || l?.reglas[0])?.id || 1;
    if (data.enabled && data.points.length) await escribirTodas(d, "zona", [{ id, points: data.points }], ch);
    else await escribirTodas(d, "zona", [], ch, false);
}
