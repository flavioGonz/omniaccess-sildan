"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { clipDeInstante, PERMISOS_VIDEO } from "@/lib/clip-instante";
import { configTelegramVideo, enviarVideoTelegram, htmlTg, type BotonTg } from "@/lib/telegram-video";
import { fecha, horaSeg } from "@/lib/fechas";
import { AJUSTE_MARCA_AGUA } from "@/lib/clips";

/**
 * Mandar por Telegram un clip de la grabación, desde Exportar clip (20/10, Nico: «poder
 * seleccionar telegram, al igual que compartir»). Es el gemelo de enviarClipPorWhatsApp
 * (actions/clips): el mismo clip (con la intro y el logo de OmniAccess, ver lib/clip-editado), el
 * mismo registro en Despachos (tipo CLIP), el mismo tope de espera.
 *
 * A quién: sólo a chats que el sistema ya conoce, como Compartir evento —
 *   - el grupo de la guardia (el chat del Centro de Notificaciones, el mismo de las alertas);
 *   - los destinatarios de Telegram cargados en el Centro de Notificaciones;
 *   - el PERSONAL que vinculó su número con el bot por privado (TELEGRAM_VINCULOS, con el mismo
 *     criterio de «personal» que el bot y el WhatsApp). A un residente vinculado no: un video del
 *     barrio por privado es cosa del personal; el residente lo pide por la guardia.
 * Un chat tipeado a mano no existe en este cajón.
 */

const TOPE_ENVIO_MS = 120_000;
const DESTINOS_MAX = 10;
const NOTA_MAX = 300;
const ROLES_PERSONAL = ["ADMIN", "STAFF", "SECURITY", "OPERATOR"];

export type DestinoTelegram = { destino: string; nombre: string; detalle: string; origen: "grupo" | "aviso" | "vinculado"; marcado: boolean };
/** conMarca: el clip sale con la intro y el logo de OmniAccess (el interruptor de Ajustes → Video del evento). */
export type EstadoTelegram = { ok: boolean; motivo?: string; destinos: DestinoTelegram[]; conMarca?: boolean };
export type ResultadoEnvioTelegram =
    | { ok: true; enviados: { destino: string; nombre: string; ok: boolean; error?: string }[]; segundos: number; fuente: string; editado: boolean }
    | { ok: false; error: string };

async function exigirVideo() {
    const s: any = await getSession();
    if (!s) throw new Error("Tenés que iniciar sesión.");
    const perms = permisosDeSesion(s);
    if (!PERMISOS_VIDEO.some((p) => perms.includes(p))) throw new Error("Tu rol no puede mandar video.");
    return s;
}

async function ajuste(key: string): Promise<string> {
    return (await prisma.setting.findUnique({ where: { key } }).catch(() => null))?.value || "";
}
const json = <T,>(t: string, def: T): T => { try { const v = JSON.parse(t || ""); return v ?? def; } catch { return def; } };
const cola8 = (t: unknown) => String(t || "").replace(/\D/g, "").slice(-8);

/** El nombre del grupo, como lo ve la guardia en Telegram. Si Telegram no contesta, uno genérico. */
async function nombreDelGrupo(token: string, chat: string): Promise<string> {
    try {
        const r = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chat)}`, { signal: AbortSignal.timeout(5000) });
        const j: any = await r.json();
        return j?.ok && j.result?.title ? String(j.result.title) : "Grupo de la guardia";
    } catch { return "Grupo de la guardia"; }
}

async function destinosConocidos(token: string, grupo: string): Promise<DestinoTelegram[]> {
    const lista: DestinoTelegram[] = [];
    if (grupo) lista.push({ destino: grupo, nombre: await nombreDelGrupo(token, grupo), detalle: "Grupo de la guardia · el de las alertas", origen: "grupo", marcado: true });

    for (const d of json<any[]>(await ajuste("DISPATCH_RECIPIENTS"), [])) {
        if (d?.channel !== "telegram" || !d.address || d.enabled === false) continue;
        const id = String(d.address).trim();
        if (!lista.some((x) => x.destino === id)) lista.push({ destino: id, nombre: d.name || id, detalle: "Destinatario de avisos", origen: "aviso", marcado: false });
    }

    // El personal vinculado por privado: el número guardado se vuelve a comparar con las fichas
    // ahora, como hace el bot — si a alguien le sacaron el rol, deja de aparecer.
    const vinculos = json<Record<string, { cola?: string; nombre?: string }>>(await ajuste("TELEGRAM_VINCULOS"), {});
    if (Object.keys(vinculos).length) {
        const usuarios = await prisma.user.findMany({ where: { role: { in: ROLES_PERSONAL as any }, phone: { not: null } }, select: { name: true, phone: true } }).catch(() => []);
        const listas = [...json<any[]>(await ajuste("BOT_ADMIN_PHONES"), []), ...json<any[]>(await ajuste("WHATSAPP_ALLOWLIST"), [])];
        for (const [id, v] of Object.entries(vinculos)) {
            const c = cola8(v?.cola);
            if (!c) continue;
            const u = usuarios.find((x) => cola8(x.phone) === c);
            const enLista = listas.some((p) => cola8(typeof p === "string" ? p : p?.phone) === c);
            if (!u && !enLista) continue;
            if (!lista.some((x) => x.destino === id)) lista.push({ destino: id, nombre: u?.name || v?.nombre || "Personal", detalle: "Por privado · vinculado al bot", origen: "vinculado", marcado: false });
        }
    }
    return lista;
}

/** Si Telegram puede mandar y a quién. El cajón lo pregunta al abrir y, sin bot, apaga la opción y dice por qué. */
export async function estadoTelegram(): Promise<EstadoTelegram> {
    try { await exigirVideo(); } catch (e: any) { return { ok: false, motivo: e.message, destinos: [] }; }
    const cfg = await configTelegramVideo();
    if (!cfg) return { ok: false, motivo: "Telegram no está configurado en este barrio (Centro de Notificaciones → Telegram: token del bot y grupo).", destinos: [] };
    const destinos = await destinosConocidos(cfg.token, cfg.grupo);
    if (!destinos.length) return { ok: false, motivo: "El bot está, pero no hay un grupo de Telegram cargado en el Centro de Notificaciones.", destinos };
    return { ok: true, destinos, conMarca: (await ajuste(AJUSTE_MARCA_AGUA)) !== "false" };
}

export async function enviarClipPorTelegram(p: { deviceId: string; instante: number; antes: number; despues: number; destinos: string[]; matricula?: string | null; nota?: string | null }): Promise<ResultadoEnvioTelegram> {
    let s: any;
    try { s = await exigirVideo(); } catch (e: any) { return { ok: false, error: e.message }; }
    if (!p.deviceId || !Number.isFinite(p.instante)) return { ok: false, error: "Falta la cámara o el instante." };
    const cfg = await configTelegramVideo();
    if (!cfg) return { ok: false, error: "Telegram no está configurado en este barrio." };
    const pedidos = [...new Set((p.destinos || []).map((d) => String(d ?? "").trim()).filter(Boolean))].slice(0, DESTINOS_MAX);
    if (!pedidos.length) return { ok: false, error: "Elegí al menos un chat." };

    const conocidos = new Map((await destinosConocidos(cfg.token, cfg.grupo)).map((d) => [d.destino, d.nombre]));
    const desconocidos = pedidos.filter((d) => !conocidos.has(d));
    if (desconocidos.length) return { ok: false, error: "Ese chat no es uno que el sistema conozca: el grupo de la guardia, un destinatario de avisos o personal vinculado al bot." };

    const dev = await prisma.device.findUnique({ where: { id: p.deviceId }, select: { name: true } });
    const destinatarios = pedidos.map((d) => ({ destino: d, nombre: conocidos.get(d) || d }));
    const enviadoPor = s?.name || s?.sub || "—";
    const nota = String(p.nota || "").trim().slice(0, NOTA_MAX);
    const job = await prisma.dispatchJob.create({
        data: {
            type: "CLIP", channel: "telegram", status: "PROCESSING", deviceId: p.deviceId, maxAttempts: 1, attempts: 1, startedAt: new Date(),
            payload: { deviceName: dev?.name || null, instante: new Date(p.instante).toISOString(), antes: p.antes, despues: p.despues, matricula: p.matricula || null, destinatarios, enviadoPor, nota: nota || null },
        },
    });
    const cerrar = (status: "SENT" | "FAILED", lastError: string | null, extra: any = {}) =>
        prisma.dispatchJob.update({ where: { id: job.id }, data: { status, lastError, sentAt: status === "SENT" ? new Date() : null, payload: { ...(job.payload as any), ...extra } } }).catch(() => null);

    const trabajo = (async (): Promise<ResultadoEnvioTelegram> => {
        const clip = await clipDeInstante({ deviceId: p.deviceId, instante: p.instante, antes: p.antes, despues: p.despues, para: "envio", matricula: p.matricula });
        if (!clip.ok) { await cerrar("FAILED", "sin video: " + clip.motivo); return { ok: false, error: "No se pudo armar el clip: " + clip.motivo }; }
        const d = new Date(p.instante);
        const segundos = clip.ventana.antes + clip.ventana.despues;
        const pie = [
            `🎬 <b>${htmlTg(dev?.name || "Cámara")}</b>`,
            `🕒 ${fecha(d)} ${horaSeg(d)}`,
            p.matricula ? `🚘 Matrícula <b>${htmlTg(p.matricula)}</b>` : null,
            nota ? `📝 ${htmlTg(nota)}` : null,
            `<i>${segundos} s de grabación · enviado por ${htmlTg(enviadoPor)} desde OmniAccess</i>`,
        ].filter(Boolean).join("\n");
        // Los botones los atiende el bot: la cámara ahora, un clip en vivo y, si hay chapa, su historial.
        const chapa = String(p.matricula || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        const botones: BotonTg[][] = [
            [{ text: "📷 La cámara ahora", callback_data: `cam:${p.deviceId}` }, { text: "🎬 Clip en vivo", callback_data: `clip:${p.deviceId}` }],
            chapa ? [{ text: `🚘 Historial de ${chapa}`, callback_data: `m:h:${chapa}` }] : [],
        ].filter((f) => f.every((b) => Buffer.byteLength(b.callback_data) <= 64));
        const enviados = [];
        for (const dst of destinatarios) {
            const r = await enviarVideoTelegram({ token: cfg.token, chatId: dst.destino, archivo: clip.archivo, nombre: clip.nombre, pie, botones, ancho: clip.ancho, alto: clip.alto, segundos: clip.segundos });
            enviados.push({ ...dst, ok: r.ok, ...(r.ok ? {} : { error: r.error }) });
        }
        const fallidos = enviados.filter((e) => !e.ok);
        await cerrar(fallidos.length === enviados.length ? "FAILED" : "SENT",
            fallidos.length ? `no llegó a ${fallidos.map((f) => `${f.nombre} (${f.error})`).join(", ")}` : null,
            { enviados, fuente: clip.fuente, ventana: clip.ventana, editado: !!clip.editado });
        return { ok: true, enviados, segundos, fuente: clip.fuente, editado: !!clip.editado };
    })();
    const tope = new Promise<ResultadoEnvioTelegram>((r) => setTimeout(() => r({ ok: false, error: `Se pasó el tiempo de espera (${TOPE_ENVIO_MS / 1000} s). Mirá Despachos: puede haber salido igual.` }), TOPE_ENVIO_MS));
    const r = await Promise.race([trabajo, tope]);
    if (!r.ok && r.error.startsWith("Se pasó")) await cerrar("FAILED", `tope de ${TOPE_ENVIO_MS / 1000} s`);
    return r;
}
