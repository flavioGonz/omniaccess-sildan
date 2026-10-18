import { leerAjuste as getSetting } from "@/lib/ajustes-db";
import axios from "axios";

/**
 * OpenWA transport layer (replaces WAHA).
 * OpenWA REST API (self-hosted on the LAN). Session-scoped endpoints:
 *   POST /api/sessions/{session}/messages/send-text   body {chatId, text}
 *   POST /api/sessions/{session}/messages/send-image  body {chatId, base64|url, mimetype, filename, caption}
 * Auth header: X-API-Key. Config from Settings (OPENWA_* with WAHA_* fallback).
 */
export async function getWhatsAppConfig() {
    const [url, apiKey, session, wahaUrl, wahaKey, hook, wahaHook, eventIp] = await Promise.all([
        getSetting("OPENWA_URL"),
        getSetting("OPENWA_API_KEY"),
        getSetting("OPENWA_SESSION"),
        getSetting("WAHA_URL"),
        getSetting("WAHA_API_KEY"),
        getSetting("OPENWA_WEBHOOK_URL"),
        getSetting("WAHA_WEBHOOK_URL"),
        getSetting("EVENT_HOST_IP"),
    ]);
    // A dónde tiene que avisar WAHA cuando llega un mensaje: el server de webhooks (:10000,
    // ruta /api/waha/webhook en server.js). Antes era un texto fijo con el IP del primer barrio
    // dentro de la pantalla de Ajustes, que no configuraba nada y mentía en cada barrio.
    // Sale de Settings; si no está, se deriva del host de eventos; si tampoco, queda vacío
    // y la pantalla lo dice (no se inventa).
    const derivedHook = eventIp?.value ? `http://${eventIp.value}:10000/api/waha/webhook` : "";
    return {
        url: (url?.value || wahaUrl?.value || process.env.OPENWA_URL || "http://192.168.99.22:2785").replace(/\/+$/, ""),
        apiKey: apiKey?.value || wahaKey?.value || process.env.OPENWA_API_KEY || "",
        session: session?.value || process.env.OPENWA_SESSION || "omniaccess",
        webhookUrl: hook?.value || wahaHook?.value || process.env.OPENWA_WEBHOOK_URL || derivedHook,
    };
}

// Backwards-compatible alias (older imports use getWahaConfig)
export const getWahaConfig = getWhatsAppConfig;

function authHeaders(apiKey?: string) {
    const h: any = { "Content-Type": "application/json" };
    if (apiKey) h["X-API-Key"] = apiKey;
    return h;
}

export async function sendWahaText(chatId: string, text: string) {
    try {
        const cfg = await getWhatsAppConfig();
        await axios.post(
            `${cfg.url}/api/sessions/${encodeURIComponent(cfg.session)}/messages/send-text`,
            { chatId, text },
            { headers: authHeaders(cfg.apiKey), timeout: 15000 }
        );
        return { success: true };
    } catch (error: any) {
        const msg = error?.response?.data?.message || error.message;
        console.error("Failed to send WhatsApp text:", msg);
        return { success: false, error: msg };
    }
}

export async function sendWahaImage(chatId: string, image: { url?: string; base64?: string }, caption?: string) {
    try {
        const cfg = await getWhatsAppConfig();
        const body: any = { chatId, mimetype: "image/jpeg", filename: "snapshot.jpg" };
        if (caption) body.caption = caption;
        if (image.base64) {
            body.base64 = image.base64.replace(/^data:[^;]+;base64,/, "");
        } else if (image.url) {
            body.url = image.url;
        }
        await axios.post(
            `${cfg.url}/api/sessions/${encodeURIComponent(cfg.session)}/messages/send-image`,
            body,
            { headers: authHeaders(cfg.apiKey), timeout: 20000 }
        );
        return { success: true };
    } catch (error: any) {
        const msg = error?.response?.data?.message || error.message;
        console.error("Failed to send WhatsApp image:", msg);
        return { success: false, error: msg };
    }
}

export const sendOpenWAText = sendWahaText;
export const sendOpenWAImage = sendWahaImage;

// ── Video por WAHA ─────────────────────────────────────────────────────────────────────
// Las funciones de arriba hablan el dialecto de OpenWA (/api/sessions/<s>/messages/...),
// que ya no corre en ningún barrio. El video va por la API de WAHA, igual que el worker de
// despachos: POST /api/sendVideo { session, chatId, file:{ mimetype, filename, url|data }, caption }.

/** Uruguay: 09x xxx xxx → 598 9x xxx xxx. Si ya viene con país, se respeta. Sólo dígitos. */
export function telefonoWhatsApp(raw?: string | null): string {
    const d = String(raw || "").replace(/\D/g, "");
    if (!d) return "";
    if (d.startsWith("598")) return d;
    if (d.startsWith("0")) return "598" + d.slice(1);
    return d.length >= 8 && d.length <= 9 ? "598" + d : d;
}

/** WAHA corre en el mismo equipo que la web: le pasamos el clip por la red interna. */
const BASE_INTERNA_POR_DEFECTO = "http://127.0.0.1:10001";

export async function enviarVideoWaha(p: { telefono: string; urlRelativa: string; base64?: () => Promise<string | null>; leyenda: string }): Promise<{ ok: boolean; error?: string }> {
    const cfg = await getWhatsAppConfig();
    const interna = ((await getSetting("INTERNAL_BASE_URL"))?.value || BASE_INTERNA_POR_DEFECTO).replace(/\/+$/, "");
    const chatId = `${telefonoWhatsApp(p.telefono)}@c.us`;
    const session = cfg.session;
    const headers = authHeaders(cfg.apiKey);
    const archivo = (extra: any) => ({ mimetype: "video/mp4", filename: "clip.mp4", ...extra });
    try {
        await axios.post(`${cfg.url}/api/sendVideo`, { session, chatId, file: archivo({ url: interna + p.urlRelativa }), caption: p.leyenda }, { headers, timeout: 60000 });
        return { ok: true };
    } catch (e: any) {
        const porUrl = e?.response?.data?.message || e?.message || String(e);
        // Último recurso: el archivo en el cuerpo (más pesado, pero no depende de que WAHA llegue a la web).
        const data = p.base64 ? await p.base64() : null;
        if (!data) return { ok: false, error: porUrl };
        try {
            await axios.post(`${cfg.url}/api/sendVideo`, { session, chatId, file: archivo({ data }), caption: p.leyenda }, { headers, timeout: 90000, maxBodyLength: Infinity, maxContentLength: Infinity });
            return { ok: true };
        } catch (e2: any) {
            return { ok: false, error: e2?.response?.data?.message || e2?.message || porUrl };
        }
    }
}

/**
 * ¿Está WhatsApp en condiciones de mandar, ahora? (18/10, Nico: «debe ser inteligente y darse
 * cuenta si está cargado y funcional; si no está activo, consultarlo antes y bloquear el envío».)
 *
 * Hasta acá «disponible» quería decir «hay una URL cargada»: con la sesión caída (en el lab estaba
 * FAILED) el panel ofrecía WhatsApp, el operador elegía destinatarios, esperaba lo que tarda armar
 * el clip y recién al final fallaba —o peor, quedaba encolado como si fuera a salir—. Ahora se le
 * pregunta a la pasarela por la sesión (WAHA y OpenWA contestan igual: /api/sessions/{nombre} con
 * `status`) y sólo WORKING cuenta como disponible. Se guarda 15 s para no consultar en cada clic.
 */
export type EstadoWhatsApp = { ok: boolean; estado: string; motivo?: string };
const ESTADO_WA_MS = 15_000;
let estadoWaCache: { t: number; v: EstadoWhatsApp } | null = null;
const MOTIVO_WA: Record<string, string> = {
    FAILED: "La sesión de WhatsApp está caída: hay que volver a vincular el teléfono (Centro de Notificaciones → WhatsApp).",
    STOPPED: "La sesión de WhatsApp está detenida: hay que iniciarla (Centro de Notificaciones → WhatsApp).",
    STARTING: "WhatsApp está arrancando: probá de nuevo en un minuto.",
    SCAN_QR_CODE: "WhatsApp espera que se escanee el código QR para vincular el teléfono (Centro de Notificaciones → WhatsApp).",
};
export async function estadoSesionWhatsApp(forzar = false): Promise<EstadoWhatsApp> {
    if (!forzar && estadoWaCache && Date.now() - estadoWaCache.t < ESTADO_WA_MS) return estadoWaCache.v;
    let v: EstadoWhatsApp;
    try {
        const cfg = await getWhatsAppConfig();
        const r = await axios.get(`${cfg.url}/api/sessions/${encodeURIComponent(cfg.session)}`, { headers: authHeaders(cfg.apiKey), timeout: 4000, validateStatus: () => true });
        if (r.status === 404) v = { ok: false, estado: "SIN_SESION", motivo: `La pasarela de WhatsApp no tiene la sesión «${cfg.session}». Hay que crearla y vincular el teléfono.` };
        else if (r.status === 401 || r.status === 403) v = { ok: false, estado: "SIN_PERMISO", motivo: "La pasarela de WhatsApp rechazó la clave de acceso (Centro de Notificaciones → WhatsApp)." };
        else if (r.status >= 400) v = { ok: false, estado: `HTTP_${r.status}`, motivo: `La pasarela de WhatsApp respondió ${r.status}.` };
        else {
            const estado = String(r.data?.status || "DESCONOCIDO").toUpperCase();
            v = estado === "WORKING" ? { ok: true, estado } : { ok: false, estado, motivo: MOTIVO_WA[estado] || `La sesión de WhatsApp no está activa (${estado}).` };
        }
    } catch (e: any) {
        v = { ok: false, estado: "SIN_RESPUESTA", motivo: "El servicio de WhatsApp no contesta: no se puede mandar nada por ahí ahora." };
    }
    estadoWaCache = { t: Date.now(), v };
    return v;
}
