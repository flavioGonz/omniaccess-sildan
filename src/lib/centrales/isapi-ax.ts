import crypto from "crypto";
import { authenticatedRequest } from "@/lib/digest-auth";
import { exigirEscritura } from "@/lib/solo-lectura";
import { hostHttp } from "@/lib/host-http";
import type { EquipoCentral } from "./tipos";

/**
 * Cómo se le habla a una AX PRO / AX Hybrid PRO por ISAPI (openspec alarm-hub-sia-dc09, tarea 4.2).
 *
 * La AX no usa digest como las cámaras: el panel web entra con una SESIÓN —
 *   1. GET  /ISAPI/Security/sessionLogin/capabilities?username=<u>   (cabecera X-Userlevel)
 *      → sessionID, challenge, salt, salt2, isIrreversible, iterations, sessionIDVersion;
 *   2. la clave se manda como un SHA-256 encadenado con esos datos (passwordSesion, abajo);
 *   3. POST /ISAPI/Security/sessionLogin?timeStamp=…  → cookie WebSession, que va en cada pedido.
 * Es lo mismo que hace la integración de Home Assistant (hikaxpro, petrleocompel), que sí se usa
 * con equipos reales; de ahí salen también las rutas de armado y estado. X-Userlevel = 1 es
 * «administrador u operador» (0 es instalador, que no puede usar estas rutas).
 *
 * Si la central no tiene sessionLogin (contesta 404), se cae al digest de siempre.
 * El guardia de sólo lectura (lib/solo-lectura) vale igual que para cualquier equipo.
 */
const NIVEL_ADMIN = "1";
const TIEMPO_MS = 12_000;
/** Cuánto se reusa una sesión antes de pedir otra (el panel web la renueva con el uso). */
const SESION_MS = 10 * 60_000;

type Cap = { sessionID: string; challenge: string; salt: string; salt2: string; isIrreversible: boolean; iterations: number; sessionIDVersion: string | null };
const sesiones = new Map<string, { cookie: string; desde: number } | { digest: true; desde: number }>();

const sha256 = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const tag = (xml: string, n: string) => { const m = new RegExp(`<${n}>([^<]*)</${n}>`).exec(xml); return m ? m[1] : null; };

export function leerCap(xml: string): Cap {
    return {
        sessionID: tag(xml, "sessionID") || "", challenge: tag(xml, "challenge") || "", salt: tag(xml, "salt") || "", salt2: tag(xml, "salt2") || "",
        isIrreversible: tag(xml, "isIrreversible") === "true", iterations: Number(tag(xml, "iterations") || 100), sessionIDVersion: tag(xml, "sessionIDVersion"),
    };
}

/** La clave como la manda el panel web de la AX (hikaxpro.encode_password, mismo algoritmo). */
export function passwordSesion(usuario: string, clave: string, c: Cap): string {
    let r: string;
    if (c.sessionIDVersion === "2" && c.isIrreversible) {
        r = sha256(`${usuario}${c.salt}${clave}`);
        r = sha256(`${r}${c.challenge}`);
        for (let i = 2; i < c.iterations; i++) r = sha256(r);
    } else if (c.isIrreversible) {
        r = sha256(`${usuario}${c.salt}${clave}`);
        r = sha256(`${usuario}${c.salt2}${r}`);
        r = sha256(`${r}${c.challenge}`);
        for (let i = 2; i < c.iterations; i++) r = sha256(r);
    } else {
        r = `${sha256(clave)}${c.challenge}`;
        for (let i = 1; i < c.iterations; i++) r = sha256(r);
    }
    return r;
}

const errorHttp = (status: number, data: any, msg?: string) => Object.assign(new Error(msg || `La central respondió ${status}`), { response: { status, data } });
const conJson = (url: string) => (url.includes("format=json") ? url : `${url}${url.includes("?") ? "&" : "?"}format=json`);

async function abrirSesion(e: EquipoCentral, base: string): Promise<{ cookie: string } | { digest: true }> {
    const usuario = e.username || "admin";
    const r1 = await fetch(`${base}/ISAPI/Security/sessionLogin/capabilities?username=${encodeURIComponent(usuario)}`, { headers: { "X-Userlevel": NIVEL_ADMIN }, signal: AbortSignal.timeout(TIEMPO_MS) });
    if (r1.status === 404) return { digest: true };
    const xml1 = await r1.text();
    if (!r1.ok) throw errorHttp(r1.status, xml1);
    const cap = leerCap(xml1);
    const cuerpo = `<SessionLogin><userName>${usuario}</userName><password>${passwordSesion(usuario, e.password || "", cap)}</password><sessionID>${cap.sessionID}</sessionID><sessionIDVersion>${cap.sessionIDVersion || "2.1"}</sessionIDVersion></SessionLogin>`;
    const r2 = await fetch(`${base}/ISAPI/Security/sessionLogin?timeStamp=${Math.floor(Date.now() / 1000)}`, { method: "POST", body: cuerpo, headers: { "Content-Type": "application/xml", "X-Userlevel": NIVEL_ADMIN }, signal: AbortSignal.timeout(TIEMPO_MS) });
    const xml2 = await r2.text();
    if (r2.status === 401 || !r2.ok) throw errorHttp(r2.status === 200 ? 401 : r2.status, xml2);
    const set = r2.headers.get("set-cookie");
    const cookie = set ? set.split(";")[0] : (tag(xml2, "sessionID") ? `WebSession=${tag(xml2, "sessionID")}` : null);
    if (!cookie) throw errorHttp(401, xml2, "La central no devolvió una sesión");
    return { cookie };
}

/** Un pedido JSON a la AX, con su sesión (o digest si no tiene sesiones). */
export async function pedirAx(e: EquipoCentral, metodo: "GET" | "PUT" | "POST", url: string, data?: unknown): Promise<any> {
    exigirEscritura(e.ip || "", metodo, url);
    const base = `http://${await hostHttp(e.ip || "", e.httpPort)}`;
    for (let intento = 0; intento < 2; intento++) {
        let s = sesiones.get(e.id);
        if (!s || Date.now() - s.desde > SESION_MS) { const n = await abrirSesion(e, base); s = { ...n, desde: Date.now() }; sesiones.set(e.id, s); }
        if ("digest" in s) {
            return authenticatedRequest(metodo, conJson(url), { ip: e.ip, httpPort: e.httpPort, username: e.username, password: e.password, authType: "DIGEST" },
                { responseType: "json", contentType: "application/json", timeout: TIEMPO_MS, data });
        }
        const r = await fetch(`${base}${conJson(url)}`, {
            method: metodo, body: data == null ? undefined : JSON.stringify(data),
            headers: { Cookie: s.cookie, "X-Userlevel": NIVEL_ADMIN, ...(data == null ? {} : { "Content-Type": "application/json" }) }, signal: AbortSignal.timeout(TIEMPO_MS),
        });
        const texto = await r.text();
        let j: any = null; try { j = texto ? JSON.parse(texto) : null; } catch { j = texto; }
        // Sesión vencida: se abre otra una vez.
        if (r.status === 401 && intento === 0) { sesiones.delete(e.id); continue; }
        if (!r.ok) throw errorHttp(r.status, j);
        return j;
    }
}

/** Para las pruebas: olvidar las sesiones abiertas. */
export function olvidarSesiones() { sesiones.clear(); }
