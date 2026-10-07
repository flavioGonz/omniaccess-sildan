"use server";

import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
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
const TOPE_ENVIO_MS = 90_000;

export type DestinatarioClip = { telefono: string; nombre: string; detalle: string; origen: "aviso" | "usuario"; habilitado: boolean };

async function exigirVideo() {
    const s: any = await getSession();
    if (!s) throw new Error("Tenés que iniciar sesión.");
    const perms = permisosDeSesion(s);
    if (!PERMISOS_VIDEO.some((p) => perms.includes(p))) throw new Error("Tu rol no puede mandar video.");
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

export async function enviarClipPorWhatsApp(p: { deviceId: string; instante: number; antes: number; despues: number; telefonos: string[]; matricula?: string | null }): Promise<ResultadoEnvioClip> {
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
            payload: { deviceName: dev?.name || null, instante: new Date(p.instante).toISOString(), antes: p.antes, despues: p.despues, matricula: p.matricula || null, destinatarios, enviadoPor },
        },
    });
    const cerrar = (status: "SENT" | "FAILED", lastError: string | null, extra: any = {}) =>
        prisma.dispatchJob.update({ where: { id: job.id }, data: { status, lastError, sentAt: status === "SENT" ? new Date() : null, payload: { ...(job.payload as any), ...extra } } }).catch(() => null);

    const trabajo = (async (): Promise<ResultadoEnvioClip> => {
        const clip = await clipDeInstante({ deviceId: p.deviceId, instante: p.instante, antes: p.antes, despues: p.despues, para: "envio", matricula: p.matricula });
        if (!clip.ok) { await cerrar("FAILED", "sin video: " + clip.motivo); return { ok: false, error: "No se pudo armar el clip: " + clip.motivo }; }
        const d = new Date(p.instante);
        const leyenda = [`🎥 ${dev?.name || "Cámara"}`, `${fecha(d)} ${hora(d)}`, p.matricula ? `Matrícula ${p.matricula}` : null, `${clip.ventana.antes + clip.ventana.despues} s · enviado por ${enviadoPor}`].filter(Boolean).join("\n");
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
    const tope = new Promise<ResultadoEnvioClip>((r) => setTimeout(() => r({ ok: false, error: "Se pasó el tiempo de espera (90 s). Mirá Despachos: puede haber salido igual." }), TOPE_ENVIO_MS));
    const r = await Promise.race([trabajo, tope]);
    if (!r.ok && r.error.startsWith("Se pasó")) await cerrar("FAILED", "tope de 90 s");
    return r;
}

export type CoberturaCamara = { id: string; nombre: string; fuente: "nvr" | "anillo" | "anillo-apagado" | "anillo-sin-arrancar"; detalle: string };

/**
 * Qué cámaras alcanzan las reglas activas y de dónde saldría el clip de cada una. Lo muestra
 * el interruptor «Clip animado en alertas» para no aparentar cubrir cámaras que no cubre.
 */
export async function coberturaClipAlertas(): Promise<{ reglasActivas: number; camaras: CoberturaCamara[] }> {
    const s: any = await getSession();
    if (!s) throw new Error("Tenés que iniciar sesión.");
    const reglas = await prisma.notificationRule.findMany({ where: { enabled: true }, select: { deviceId: true, modulo: true, channels: true } });
    const conVideo = reglas.filter((r) => /whatsapp|telegram/.test(String(r.channels || "")));
    const ids = new Set<string>(); const tipos = new Set<string>();
    for (const r of conVideo) { if (r.deviceId) ids.add(r.deviceId); else for (const t of TIPOS_POR_MODULO[r.modulo] || []) tipos.add(t); }
    if (!ids.size && !tipos.size) return { reglasActivas: conVideo.length, camaras: [] };
    const devs = await prisma.device.findMany({ where: { OR: [{ id: { in: [...ids] } }, { deviceType: { in: [...tipos] as any } }] }, select: { id: true, name: true, ip: true }, orderBy: { name: "asc" } });
    const mapa = await getChannelMap();
    const nvrs = await prisma.device.findMany({ where: { deviceType: "NVR" as any }, select: { id: true, name: true } });
    const prendido = (await prisma.setting.findUnique({ where: { key: "DISPATCH_ANIMATED" } }))?.value === "true";
    const camaras: CoberturaCamara[] = devs.map((d) => {
        const e = d.ip ? mapa[d.ip] : null;
        if (e?.ch) return { id: d.id, nombre: d.name, fuente: "nvr", detalle: `${nvrs.find((n) => n.id === e.nvrId)?.name || "NVR"} · canal ${e.ch}` };
        if (!prendido) return { id: d.id, nombre: d.name, fuente: "anillo-apagado", detalle: "grabación local (arranca al prender el interruptor)" };
        const grabando = segmentosAnillo(path.join(DIR_ANILLO, d.id)).some((x) => Date.now() - x.fin < 10_000);
        return grabando
            ? { id: d.id, nombre: d.name, fuente: "anillo", detalle: "grabación local, últimos 80 s" }
            : { id: d.id, nombre: d.name, fuente: "anillo-sin-arrancar", detalle: "sin video: la grabación local no está corriendo (va con foto)" };
    });
    return { reglasActivas: conVideo.length, camaras };
}
