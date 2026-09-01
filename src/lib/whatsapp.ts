import { getSetting } from "@/app/actions/settings";
import axios from "axios";

/**
 * OpenWA transport layer (replaces WAHA).
 * OpenWA REST API (self-hosted on the LAN). Session-scoped endpoints:
 *   POST /api/sessions/{session}/messages/send-text   body {chatId, text}
 *   POST /api/sessions/{session}/messages/send-image  body {chatId, base64|url, mimetype, filename, caption}
 * Auth header: X-API-Key. Config from Settings (OPENWA_* with WAHA_* fallback).
 */
export async function getWhatsAppConfig() {
    const [url, apiKey, session, wahaUrl, wahaKey] = await Promise.all([
        getSetting("OPENWA_URL"),
        getSetting("OPENWA_API_KEY"),
        getSetting("OPENWA_SESSION"),
        getSetting("WAHA_URL"),
        getSetting("WAHA_API_KEY"),
    ]);
    return {
        url: (url?.value || wahaUrl?.value || process.env.OPENWA_URL || "http://192.168.99.22:2785").replace(/\/+$/, ""),
        apiKey: apiKey?.value || wahaKey?.value || process.env.OPENWA_API_KEY || "",
        session: session?.value || process.env.OPENWA_SESSION || "omniaccess",
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
