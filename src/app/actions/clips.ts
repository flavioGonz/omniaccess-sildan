"use server";

import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { clipDeInstante, DIR_CLIPS, DIR_ANILLO, PERMISOS_VIDEO, segmentosAnillo } from "@/lib/clip-instante";
import { TIPOS_POR_MODULO } from "@/lib/clips";
import { getChannelMap } from "@/lib/nvr-resolve";
import { enviarVideoWaha, telefonoWhatsApp } from "@/lib/whatsapp";
import { fecha, hora } from "@/lib/fechas";

/**
 * Mandar por WhatsApp un clip de la grabación, desde el diálogo de descarga del playback.
 *
 * Los destinatarios sólo pueden ser gente que el sistema ya conoce: los destinatarios de
 * WhatsApp del Centro de Notificaciones y los usuarios/residentes con teléfono en su ficha.
 * Un video del barrio no sale a un número tipeado a mano. Cada envío queda en Despachos
 * (tipo CLIP) con quién lo mandó, a quién y cómo terminó.
 */

/** Cuánto espera el operador, como mucho: armar el clip (tiempo real del NVR) + mandarlo. */
const TOPE_ENVIO_MS = 150_000;

export type DestinatarioClip = { telefono: string; nombre: string; detalle: string; origen: "aviso" | "usuario"; habilitado: boolean };

async function exigirVideo() {
    const s: any = await getSession();
    if (!s) throw new Error("Tenés que iniciar sesión.");
    // En Olivos todavía no hay roles por pantalla (Fase 4): cualquier sesión del panel ve video.
    return s;
}

async function destinatariosDeAviso(): Promise<DestinatarioClip[]> {
    let lista: any[] = [];
    try { lista = JSON.parse((await prisma.setting.findUnique({ where: { key: "DISPATCH_RECIPIENTS" } }))?.value || "[]"); } catch { }
    return (Array.isArray(lista) ? lista : [])
        .filter((d) => d?.channel === "whatsapp" && telefonoWhatsApp(d.address))
        .map((d) => ({ telefono: telefonoWhatsApp(d.address), nombre: d.name || d.address, detalle: "Destinatario de avisos", origen: "aviso" as const, habilitado: d.enabled !== false }));
}

const ROL: Record<string, string> = { RESIDENT: "Residente", STAFF: "Personal", ADMIN: "Administración", SECURITY: "Seguridad", OPERATOR: "Operador", PROVIDER: "Proveedor", VISITOR: "Visita" };

/** Los destinatarios de avisos (siempre) y, si hay búsqueda, los usuarios con teléfono que coinciden. */
export async function buscarDestinatariosClip(q: string): Promise<{ avisos: DestinatarioClip[]; usuarios: DestinatarioClip[] }> {
    await exigirVideo();
    const avisos = await destinatariosDeAviso();
    const texto = String(q || "").trim();
    if (texto.length < 2) return { avisos, usuarios: [] };
    const digitos = texto.replace(/\D/g, "");
    const filas = await prisma.user.findMany({
        where: {
            phone: { not: null },
            role: { not: "BLACKLISTED" as any },
            OR: [
                { name: { contains: texto, mode: "insensitive" } },
                { unit: { name: { contains: texto, mode: "insensitive" } } },
                ...(digitos.length >= 3 ? [{ phone: { contains: digitos } }] : []),
            ],
        },
        select: { name: true, phone: true, role: true, unit: { select: { name: true } } },
        take: 12, orderBy: { name: "asc" },
    });
    const yaEstan = new Set(avisos.map((a) => a.telefono));
    const usuarios = filas
        .map((u) => ({ telefono: telefonoWhatsApp(u.phone), nombre: u.name, detalle: [ROL[String(u.role)] || String(u.role), u.unit?.name].filter(Boolean).join(" · "), origen: "usuario" as const, habilitado: true }))
        .filter((u) => u.telefono.length >= 10 && !yaEstan.has(u.telefono));
    return { avisos, usuarios };
}

export type ResultadoEnvioClip =
    | { ok: true; enviados: { telefono: string; nombre: string; ok: boolean; error?: string }[]; segundos: number; fuente: string }
    | { ok: false; error: string };

export async function enviarClipPorWhatsApp(p: { deviceId: string; instante: number; antes: number; despues: number; telefonos: string[]; matricula?: string | null; descripcion?: string | null; intro?: boolean }): Promise<ResultadoEnvioClip> {
    let s: any;
    try { s = await exigirVideo(); } catch (e: any) { return { ok: false, error: e.message }; }
    const pedidos = [...new Set((p.telefonos || []).map(telefonoWhatsApp).filter(Boolean))];
    if (!pedidos.length) return { ok: false, error: "Elegí al menos un destinatario." };
    if (!p.deviceId || !Number.isFinite(p.instante)) return { ok: false, error: "Falta la cámara o el instante." };

    // Cada número tiene que ser alguien conocido: un destinatario de avisos o un usuario con ese teléfono.
    const avisos = await destinatariosDeAviso();
    const usuarios = await prisma.user.findMany({ where: { phone: { not: null }, role: { not: "BLACKLISTED" as any } }, select: { name: true, phone: true } });
    const conocidos = new Map<string, string>();
    for (const a of avisos) conocidos.set(a.telefono, a.nombre);
    for (const u of usuarios) { const t = telefonoWhatsApp(u.phone); if (t && !conocidos.has(t)) conocidos.set(t, u.name); }
    const desconocidos = pedidos.filter((t) => !conocidos.has(t));
    if (desconocidos.length) return { ok: false, error: `No se manda video a números que el sistema no conoce (${desconocidos.join(", ")}). Cargalo como destinatario de avisos o en la ficha del usuario.` };

    const dev = await prisma.device.findUnique({ where: { id: p.deviceId }, select: { name: true } });
    const destinatarios = pedidos.map((t) => ({ telefono: t, nombre: conocidos.get(t) || t }));
    const enviadoPor = s?.name || s?.sub || "—";
    const job = await prisma.dispatchJob.create({
        data: {
            type: "CLIP", channel: "whatsapp", status: "PROCESSING", deviceId: p.deviceId, maxAttempts: 1, attempts: 1, startedAt: new Date(),
            payload: { descripcion: p.descripcion || null, deviceName: dev?.name || null, instante: new Date(p.instante).toISOString(), antes: p.antes, despues: p.despues, matricula: p.matricula || null, destinatarios, enviadoPor },
        },
    });
    const cerrar = (status: "SENT" | "FAILED", lastError: string | null, extra: any = {}) =>
        prisma.dispatchJob.update({ where: { id: job.id }, data: { status, lastError, sentAt: status === "SENT" ? new Date() : null, payload: { ...(job.payload as any), ...extra } } }).catch(() => null);

    const trabajo = (async (): Promise<ResultadoEnvioClip> => {
        const descripcion = String(p.descripcion || "").trim().slice(0, 140) || null;
        const clip = await clipDeInstante({ deviceId: p.deviceId, instante: p.instante, antes: p.antes, despues: p.despues, para: "envio", matricula: p.matricula, descripcion, intro: p.intro });
        if (!clip.ok) { await cerrar("FAILED", "sin video: " + clip.motivo); return { ok: false, error: "No se pudo armar el clip: " + clip.motivo }; }
        const d = new Date(p.instante);
        const leyenda = [descripcion ? `*${descripcion}*` : null, `Cámara: ${dev?.name || "sin nombre"}`, `${fecha(d)} ${hora(d)}`, p.matricula ? `Matrícula ${p.matricula}` : null, `${clip.ventana.antes + clip.ventana.despues} s · enviado por ${enviadoPor}`].filter(Boolean).join("\n");
        const base64 = async () => { try { return fs.readFileSync(path.join(DIR_CLIPS, clip.nombre)).toString("base64"); } catch { return null; } };
        const enviados = [];
        for (const dst of destinatarios) {
            const r = await enviarVideoWaha({ telefono: dst.telefono, urlRelativa: clip.url, base64, leyenda });
            enviados.push({ ...dst, ok: r.ok, ...(r.ok ? {} : { error: r.error }) });
        }
        const fallidos = enviados.filter((e) => !e.ok);
        await cerrar(fallidos.length === enviados.length ? "FAILED" : "SENT",
            fallidos.length ? `no llegó a ${fallidos.map((f) => `${f.nombre} (${f.error})`).join(", ")}` : null,
            { enviados, fuente: clip.fuente, ventana: clip.ventana });
        return { ok: true, enviados, segundos: clip.ventana.antes + clip.ventana.despues, fuente: clip.fuente };
    })();
    const tope = new Promise<ResultadoEnvioClip>((r) => setTimeout(() => r({ ok: false, error: "Se pasó el tiempo de espera (150 s). Mirá Despachos: puede haber salido igual." }), TOPE_ENVIO_MS));
    const r = await Promise.race([trabajo, tope]);
    if (!r.ok && r.error.startsWith("Se pasó")) await cerrar("FAILED", "tope de 90 s");
    return r;
}

/* ─── Telegram ────────────────────────────────────────────────────────────────────────────
 * El mismo clip (con la intro y la marca de agua de OmniAccess) al grupo de alertas o a los
 * chats extra del bot. Los destinos son solo los que el bot ya tiene autorizados: el grupo
 * (TELEGRAM_CHAT_ID) y TELEGRAM_BOT_CHATS. Cada envío queda en Despachos y en el historial de
 * Telegram (/admin/notificaciones).
 */
export type DestinoTelegram = { chatId: string; nombre: string; detalle: string; principal: boolean };
let cacheNombres: { t: number; v: Record<string, { nombre: string; tipo: string }> } = { t: 0, v: {} };

async function configTelegram() {
    const filas = await prisma.setting.findMany({ where: { key: { in: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_BOT_CHATS"] } } });
    const m = Object.fromEntries(filas.map((f) => [f.key, f.value]));
    const token = m.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
    const grupo = m.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || "";
    const extras = String(m.TELEGRAM_BOT_CHATS || "").split(/[,\s]+/).filter(Boolean).filter((c) => c !== grupo);
    return { token, grupo, extras };
}

export async function destinosTelegramClip(): Promise<{ configurado: boolean; destinos: DestinoTelegram[] }> {
    await exigirVideo();
    const { token, grupo, extras } = await configTelegram();
    if (!token || !grupo) return { configurado: false, destinos: [] };
    const ids = [grupo, ...extras];
    if (Date.now() - cacheNombres.t > 10 * 60_000) cacheNombres = { t: Date.now(), v: {} };
    await Promise.all(ids.filter((id) => !cacheNombres.v[id]).map(async (id) => {
        try {
            const r = await fetch(`https://api.telegram.org/bot${token}/getChat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: id }), signal: AbortSignal.timeout(6000) });
            const j: any = await r.json();
            if (j.ok) cacheNombres.v[id] = { nombre: j.result.title || [j.result.first_name, j.result.last_name].filter(Boolean).join(" ") || id, tipo: j.result.type };
        } catch { }
    }));
    const destinos = ids.map((id) => {
        const c = cacheNombres.v[id];
        const tipo = c?.tipo === "private" ? "Chat privado" : c?.tipo === "channel" ? "Canal" : "Grupo";
        return { chatId: id, nombre: c?.nombre || (id === grupo ? "Grupo de alertas" : id), detalle: id === grupo ? `${tipo} de alertas` : tipo, principal: id === grupo };
    });
    return { configurado: true, destinos };
}

export type ResultadoTelegramClip =
    | { ok: true; enviados: { chatId: string; nombre: string; ok: boolean; error?: string }[]; segundos: number; fuente: string }
    | { ok: false; error: string };

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function enviarClipPorTelegram(p: { deviceId: string; instante: number; antes: number; despues: number; chats: string[]; matricula?: string | null; descripcion?: string | null; intro?: boolean }): Promise<ResultadoTelegramClip> {
    let s: any;
    try { s = await exigirVideo(); } catch (e: any) { return { ok: false, error: e.message }; }
    const { token, grupo, extras } = await configTelegram();
    if (!token || !grupo) return { ok: false, error: "Telegram no está configurado (Notificaciones › Canales)." };
    const permitidos = new Set([grupo, ...extras]);
    const pedidos = [...new Set((p.chats || []).map(String))];
    if (!pedidos.length) return { ok: false, error: "Elegí al menos un destino." };
    const ajenos = pedidos.filter((c) => !permitidos.has(c));
    if (ajenos.length) return { ok: false, error: "Solo se puede mandar a los chats autorizados del bot." };
    if (!p.deviceId || !Number.isFinite(p.instante)) return { ok: false, error: "Falta la cámara o el instante." };

    const { destinos } = await destinosTelegramClip();
    const nombreDe = (id: string) => destinos.find((d) => d.chatId === id)?.nombre || id;
    const dev = await prisma.device.findUnique({ where: { id: p.deviceId }, select: { name: true } });
    const enviadoPor = s?.name || s?.sub || "—";
    const job = await prisma.dispatchJob.create({
        data: {
            type: "CLIP", channel: "telegram", status: "PROCESSING", deviceId: p.deviceId, maxAttempts: 1, attempts: 1, startedAt: new Date(),
            payload: { descripcion: p.descripcion || null, deviceName: dev?.name || null, instante: new Date(p.instante).toISOString(), antes: p.antes, despues: p.despues, matricula: p.matricula || null, destinatarios: pedidos.map((c) => ({ chatId: c, nombre: nombreDe(c) })), enviadoPor },
        },
    });
    const cerrar = (status: "SENT" | "FAILED", lastError: string | null, extra: any = {}) =>
        prisma.dispatchJob.update({ where: { id: job.id }, data: { status, lastError, sentAt: status === "SENT" ? new Date() : null, payload: { ...(job.payload as any), ...extra } } }).catch(() => null);
    const registrar = (decision: string, chat: string, motivo: string | null) =>
        prisma.telegramEnvio.create({ data: { categoria: "clip", subtipo: "manual", deviceId: p.deviceId, refId: job.id, titulo: `${p.descripcion || "Clip"} · ${dev?.name || ""} · ${nombreDe(chat)}`.slice(0, 200), decision, motivo: motivo ? motivo.slice(0, 300) : `enviado por ${enviadoPor}` } }).catch(() => null);

    const trabajo = (async (): Promise<ResultadoTelegramClip> => {
        const descripcion = String(p.descripcion || "").trim().slice(0, 140) || null;
        const clip = await clipDeInstante({ deviceId: p.deviceId, instante: p.instante, antes: p.antes, despues: p.despues, para: "envio", matricula: p.matricula, descripcion, intro: p.intro });
        if (!clip.ok) { await cerrar("FAILED", "sin video: " + clip.motivo); return { ok: false, error: "No se pudo armar el clip: " + clip.motivo }; }
        if (clip.bytes > 49 * 1024 * 1024) { await cerrar("FAILED", "supera 50 MB"); return { ok: false, error: "El clip supera el límite de Telegram (50 MB). Probá con menos segundos." }; }
        const buf = fs.readFileSync(path.join(DIR_CLIPS, clip.nombre));
        const d = new Date(p.instante);
        const leyenda = [descripcion ? `<b>${escHtml(descripcion)}</b>` : "<b>Clip de video</b>", `Cámara: ${escHtml(dev?.name || "sin nombre")}`, `${fecha(d)} ${hora(d)}`, p.matricula ? `Matrícula <code>${escHtml(p.matricula)}</code>` : null, `${clip.ventana.antes + clip.ventana.despues} s · enviado por ${escHtml(String(enviadoPor))}`].filter(Boolean).join("\n");
        const enviados: { chatId: string; nombre: string; ok: boolean; error?: string }[] = [];
        for (const chat of pedidos) {
            try {
                const fd = new FormData();
                fd.append("chat_id", chat); fd.append("caption", leyenda.slice(0, 1024)); fd.append("parse_mode", "HTML"); fd.append("supports_streaming", "true");
                fd.append("video", new Blob([new Uint8Array(buf)], { type: "video/mp4" }), clip.nombre);
                const r = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, { method: "POST", body: fd, signal: AbortSignal.timeout(120_000) });
                const j: any = await r.json().catch(() => ({}));
                if (!j.ok) throw new Error(j.description || `respuesta ${r.status}`);
                enviados.push({ chatId: chat, nombre: nombreDe(chat), ok: true });
                await registrar("ENVIADO", chat, null);
            } catch (e: any) {
                enviados.push({ chatId: chat, nombre: nombreDe(chat), ok: false, error: String(e?.message || e) });
                await registrar("ERROR", chat, String(e?.message || e));
            }
        }
        const fallidos = enviados.filter((e) => !e.ok);
        await cerrar(fallidos.length === enviados.length ? "FAILED" : "SENT", fallidos.length ? `no llegó a ${fallidos.map((f) => `${f.nombre} (${f.error})`).join(", ")}` : null, { enviados, fuente: clip.fuente, ventana: clip.ventana });
        return { ok: true, enviados, segundos: clip.ventana.antes + clip.ventana.despues, fuente: clip.fuente };
    })();
    const tope = new Promise<ResultadoTelegramClip>((r) => setTimeout(() => r({ ok: false, error: "Se pasó el tiempo de espera (150 s). Mirá Despachos: puede haber salido igual." }), TOPE_ENVIO_MS));
    const r = await Promise.race([trabajo, tope]);
    if (!r.ok && r.error.startsWith("Se pasó")) await cerrar("FAILED", "tope de 150 s");
    return r;
}
