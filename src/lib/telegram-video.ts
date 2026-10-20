import fs from "fs";
import { prisma } from "@/lib/prisma";

/**
 * Mandar un video por Telegram desde el panel (Exportar clip).
 *
 * Se SUBE el archivo (sendVideo multipart), no se pasa una URL: Telegram tendría que bajarlo de
 * una dirección pública del barrio, y en San Nicolás no hay (no hay PUBLIC_BASE_URL, y /api/clip
 * vive detrás del proxy). Subido, además, llega aunque el clip ya se haya purgado del disco.
 *
 * El token y el grupo son los mismos del bot y de las alertas (Ajustes › Notificaciones o .env). Los
 * botones que van con el video (la cámara ahora, un clip en vivo, el historial de la matrícula) los
 * atiende el bot (telegram-bot.js), que es quien escucha al mismo token.
 */

/** Lo que acepta la Bot API por subida directa. Arriba de eso, Telegram contesta 413. */
export const TELEGRAM_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
/** Telegram corta el pie de un video en 1024 caracteres. */
export const TELEGRAM_PIE_MAX = 1024;
const TOPE_SUBIDA_MS = 60_000;

export type ConfigTelegram = { token: string; grupo: string };

export async function configTelegramVideo(): Promise<ConfigTelegram | null> {
    let token = process.env.TELEGRAM_BOT_TOKEN || "", grupo = process.env.TELEGRAM_CHAT_ID || "";
    if (!token || !grupo) {
        const filas = await prisma.setting.findMany({ where: { key: { in: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] } } }).catch(() => []);
        const v = Object.fromEntries(filas.map((f) => [f.key, (f.value || "").trim()]));
        token ||= v.TELEGRAM_BOT_TOKEN || ""; grupo ||= v.TELEGRAM_CHAT_ID || "";
    }
    return token ? { token, grupo } : null;
}

/** Telegram manda el pie en HTML: lo que trae el evento no puede romperlo. */
export const htmlTg = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type BotonTg = { text: string; callback_data: string };

export async function enviarVideoTelegram(p: {
    token: string; chatId: string; archivo: string; nombre: string; pie: string;
    botones?: BotonTg[][]; ancho?: number; alto?: number; segundos?: number;
}): Promise<{ ok: true; mensaje: number | null } | { ok: false; error: string }> {
    let buf: Buffer;
    try { buf = fs.readFileSync(p.archivo); } catch { return { ok: false, error: "el clip ya no está en el disco" }; }
    if (buf.length > TELEGRAM_VIDEO_MAX_BYTES) return { ok: false, error: `el clip pesa ${(buf.length / 1048576).toFixed(0)} MB y Telegram acepta hasta 50 MB: probá con un tramo más corto` };
    const f = new FormData();
    f.append("chat_id", p.chatId);
    f.append("video", new Blob([new Uint8Array(buf)], { type: "video/mp4" }), p.nombre);
    f.append("caption", p.pie.slice(0, TELEGRAM_PIE_MAX));
    f.append("parse_mode", "HTML");
    // Sin esto el teléfono baja el video entero antes de mostrar el primer cuadro.
    f.append("supports_streaming", "true");
    if (p.ancho) f.append("width", String(p.ancho));
    if (p.alto) f.append("height", String(p.alto));
    if (p.segundos) f.append("duration", String(Math.round(p.segundos)));
    const filas = (p.botones || []).filter((x) => x.length);
    if (filas.length) f.append("reply_markup", JSON.stringify({ inline_keyboard: filas }));
    try {
        const r = await fetch(`https://api.telegram.org/bot${p.token}/sendVideo`, { method: "POST", body: f, signal: AbortSignal.timeout(TOPE_SUBIDA_MS) });
        const j: any = await r.json().catch(() => ({}));
        if (!j?.ok) return { ok: false, error: traducir(j?.description || `Telegram respondió ${r.status}`) };
        return { ok: true, mensaje: j.result?.message_id ?? null };
    } catch (e: any) {
        return { ok: false, error: e?.name === "TimeoutError" ? "Telegram no terminó de recibir el video en 60 s" : `no se pudo llegar a Telegram (${e?.message || e})` };
    }
}

/** Los errores de Telegram que el operador puede resolver, dichos en castellano. */
function traducir(d: string): string {
    if (/chat not found/i.test(d)) return "Telegram no encuentra ese chat: el bot no está en el grupo, o la persona nunca le escribió al bot.";
    if (/bot was kicked|not a member/i.test(d)) return "Sacaron al bot de ese grupo: hay que volver a agregarlo.";
    if (/blocked by the user/i.test(d)) return "Esa persona bloqueó al bot.";
    if (/too large|request entity/i.test(d)) return "El clip es demasiado grande para Telegram (hasta 50 MB).";
    if (/unauthorized/i.test(d)) return "El token del bot no es válido (Centro de Notificaciones → Telegram).";
    return d;
}
