"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { PERMISOS_VIDEO, ventanaAlerta } from "@/lib/clip-instante";
import { telefonoWhatsApp, estadoSesionWhatsApp } from "@/lib/whatsapp";
import { enqueueDispatch } from "@/lib/dispatch-queue";

/**
 * Compartir un evento (la foto con sus datos) por WhatsApp o Telegram, desde el visor.
 *
 * Va por la MISMA cola que las alertas (dispatch-worker): sale con la foto del evento, y con el
 * clip si «Clip animado en alertas» está prendido. Así un evento compartido a mano llega igual
 * que una alerta, y queda en Despachos con quién lo mandó.
 *
 * Igual que el clip por WhatsApp (actions/clips): los destinatarios sólo pueden ser gente que el
 * sistema ya conoce — los destinatarios de avisos del Centro de Notificaciones y los usuarios con
 * teléfono en su ficha. Una foto del barrio no sale a un número tipeado a mano.
 */

/** Cuántos destinatarios por envío: más es una difusión, y eso es una regla de notificación. */
const DESTINOS_MAX = 10;
/** Lo que entra en un pie de foto de WhatsApp/Telegram sin que lo corten (Telegram corta en 1024). */
const TEXTO_MAX = 900;
const NOTA_MAX = 300;

export type DestinoCompartir = { canal: "whatsapp" | "telegram"; destino: string; nombre: string; detalle: string };
export type OpcionesCompartir = {
    whatsapp: { disponible: boolean; motivo?: string; avisos: DestinoCompartir[]; usuarios: DestinoCompartir[] };
    telegram: { disponible: boolean; motivo?: string; destinos: DestinoCompartir[] };
    /** «Clip animado en alertas» prendido: el worker suma el video del instante. */
    conClip: boolean;
    /** El tramo que arma el worker para ese clip (Ajustes → Video del evento, la ventana de alertas): lo usa el panel para mostrar qué se le pide al NVR. */
    ventanaClip: { antes: number; despues: number };
};

async function exigir() {
    const s: any = await getSession();
    if (!s) throw new Error("Tenés que iniciar sesión.");
    const perms = permisosDeSesion(s);
    if (!PERMISOS_VIDEO.some((p) => perms.includes(p))) throw new Error("Tu rol no puede compartir eventos.");
    return s;
}

async function ajuste(key: string): Promise<string> {
    return (await prisma.setting.findUnique({ where: { key } }).catch(() => null))?.value || "";
}

async function destinatarios(): Promise<any[]> {
    try { const l = JSON.parse(await ajuste("DISPATCH_RECIPIENTS") || "[]"); return Array.isArray(l) ? l : []; } catch { return []; }
}

const ROL: Record<string, string> = { RESIDENT: "Residente", STAFF: "Personal", ADMIN: "Administración", SECURITY: "Seguridad", OPERATOR: "Operador", PROVIDER: "Proveedor", VISITOR: "Visita" };

/**
 * Por qué canales se puede compartir y a quién. Un canal sin configurar se devuelve como no
 * disponible y con el motivo: el diálogo lo dice en vez de ofrecer un botón que no manda nada.
 */
export async function opcionesCompartir(q = ""): Promise<OpcionesCompartir> {
    await exigir();
    const lista = await destinatarios();
    const [waUrl, tgToken, tgChat, animado] = await Promise.all([
        ajuste("OPENWA_URL").then((v) => v || ajuste("WAHA_URL")), ajuste("TELEGRAM_BOT_TOKEN"), ajuste("TELEGRAM_CHAT_ID"), ajuste("DISPATCH_ANIMATED"),
    ]);

    const avisos: DestinoCompartir[] = lista
        .filter((d) => d?.channel === "whatsapp" && d.enabled !== false && telefonoWhatsApp(d.address))
        .map((d) => ({ canal: "whatsapp" as const, destino: telefonoWhatsApp(d.address), nombre: d.name || d.address, detalle: "Destinatario de avisos" }));
    let usuarios: DestinoCompartir[] = [];
    const texto = String(q || "").trim();
    if (texto.length >= 2) {
        const digitos = texto.replace(/\D/g, "");
        const filas = await prisma.user.findMany({
            where: {
                phone: { not: null }, role: { not: "BLACKLISTED" as any },
                OR: [
                    { name: { contains: texto, mode: "insensitive" } },
                    { unit: { name: { contains: texto, mode: "insensitive" } } },
                    ...(digitos.length >= 3 ? [{ phone: { contains: digitos } }] : []),
                ],
            },
            select: { name: true, phone: true, role: true, unit: { select: { name: true } } }, take: 12, orderBy: { name: "asc" },
        });
        const ya = new Set(avisos.map((a) => a.destino));
        usuarios = filas
            .map((u) => ({ canal: "whatsapp" as const, destino: telefonoWhatsApp(u.phone), nombre: u.name, detalle: [ROL[String(u.role)] || String(u.role), u.unit?.name].filter(Boolean).join(" · ") }))
            .filter((u) => u.destino.length >= 10 && !ya.has(u.destino));
    }

    const tgToken2 = tgToken || process.env.TELEGRAM_BOT_TOKEN || "";
    const tgDestinos: DestinoCompartir[] = lista
        .filter((d) => d?.channel === "telegram" && d.enabled !== false && d.address)
        .map((d) => ({ canal: "telegram" as const, destino: String(d.address), nombre: d.name || String(d.address), detalle: "Destinatario de avisos" }));
    if (tgToken2 && (tgChat || process.env.TELEGRAM_CHAT_ID) && !tgDestinos.length) {
        tgDestinos.push({ canal: "telegram", destino: "", nombre: "Grupo de la guardia", detalle: "El chat de Telegram del Centro de Notificaciones" });
    }

    // Configurado no alcanza: la sesión tiene que estar andando (ver estadoSesionWhatsApp).
    const waConfigurado = !!(waUrl || process.env.OPENWA_URL);
    const waEstado = waConfigurado ? await estadoSesionWhatsApp() : null;
    return {
        whatsapp: {
            disponible: waConfigurado && !!waEstado?.ok,
            motivo: !waConfigurado ? "WhatsApp no está configurado en el Centro de Notificaciones." : !waEstado?.ok ? waEstado?.motivo : undefined,
            avisos, usuarios,
        },
        telegram: {
            disponible: !!tgToken2 && tgDestinos.length > 0,
            motivo: !tgToken2 ? "Telegram no está configurado en este barrio (Centro de Notificaciones → Telegram: token del bot y chat)."
                : !tgDestinos.length ? "No hay un chat de Telegram cargado en el Centro de Notificaciones." : undefined,
            destinos: tgDestinos,
        },
        conClip: animado === "true",
        ventanaClip: await ventanaAlerta(),
    };
}

/** Telegram manda el pie en HTML: lo que escribe el operador o trae el evento no puede romperlo. */
const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type ResultadoCompartir = { ok: true; trabajos: { id: string; nombre: string }[] } | { ok: false; error: string };

export async function compartirEvento(p: {
    canal: "whatsapp" | "telegram";
    destinos: string[];
    /** La foto del evento, como la sirve el panel (/api/files/…, /api/snapshot/…). */
    foto: string | null;
    deviceId: string | null;
    deviceName: string | null;
    instante: string;
    titulo: string;
    lineas: string[];
    nota?: string | null;
}): Promise<ResultadoCompartir> {
    let s: any;
    try { s = await exigir(); } catch (e: any) { return { ok: false, error: e.message }; }
    const opciones = await opcionesCompartir("");
    const pedidos = [...new Set((p.destinos || []).map((d) => String(d ?? "")))].slice(0, DESTINOS_MAX);
    if (!pedidos.length) return { ok: false, error: "Elegí al menos un destinatario." };

    // Cada destino tiene que ser conocido (ver arriba).
    const conocidos = new Map<string, string>();
    if (p.canal === "telegram") {
        if (!opciones.telegram.disponible) return { ok: false, error: opciones.telegram.motivo || "Telegram no está disponible." };
        for (const d of opciones.telegram.destinos) conocidos.set(d.destino, d.nombre);
    } else {
        if (!opciones.whatsapp.disponible) return { ok: false, error: opciones.whatsapp.motivo || "WhatsApp no está disponible." };
        for (const d of opciones.whatsapp.avisos) conocidos.set(d.destino, d.nombre);
        const usuarios = await prisma.user.findMany({ where: { phone: { not: null }, role: { not: "BLACKLISTED" as any } }, select: { name: true, phone: true } });
        for (const u of usuarios) { const t = telefonoWhatsApp(u.phone); if (t && !conocidos.has(t)) conocidos.set(t, u.name); }
    }
    const destinos = p.canal === "whatsapp" ? pedidos.map(telefonoWhatsApp).filter(Boolean) : pedidos;
    const desconocidos = destinos.filter((d) => !conocidos.has(d));
    if (desconocidos.length) return { ok: false, error: `No se comparte con destinos que el sistema no conoce (${desconocidos.join(", ") || "vacío"}). Cargalo como destinatario de avisos o en la ficha del usuario.` };

    // Sólo fotos servidas por el propio panel: el worker la baja de la red interna (WhatsApp) o la
    // pasa por URL pública (Telegram). Una URL de afuera no se reenvía.
    const foto = p.foto && p.foto.startsWith("/api/") && !p.foto.startsWith("/api/snapshot/") ? p.foto.split("?")[0] : null;
    // Sin foto guardada el worker manda el cuadro de AHORA de la cámara: eso no es el evento.
    if (!foto) return { ok: false, error: "Este evento no tiene la foto guardada: no hay qué compartir." };
    const instante = new Date(p.instante);
    if (isNaN(+instante)) return { ok: false, error: "Falta el instante del evento." };
    const enviadoPor = s?.name || s?.sub || "—";
    const nota = String(p.nota || "").trim().slice(0, NOTA_MAX);
    const cuerpo = [String(p.titulo || "Evento").trim(), ...(p.lineas || []).map((l) => String(l).trim()).filter(Boolean), nota ? `\n${nota}` : null, `Compartido por ${enviadoPor}`]
        .filter(Boolean).join("\n").slice(0, TEXTO_MAX);
    const texto = p.canal === "telegram" ? html(cuerpo) : cuerpo;

    const trabajos: { id: string; nombre: string }[] = [];
    for (const d of destinos) {
        const job = await enqueueDispatch({
            type: "ALERT", channel: p.canal, maxAttempts: 2, deviceId: p.deviceId || null,
            payload: {
                evento: "compartido", ruleName: "Compartido desde el panel", asunto: p.titulo,
                deviceName: p.deviceName || null, snapshotPath: foto, instante: instante.toISOString(),
                text: texto, enviadoPor,
                ...(d ? { to: d, chatId: d } : {}),
            },
        });
        trabajos.push({ id: job.id, nombre: conocidos.get(d) || d || "Grupo" });
    }
    return { ok: true, trabajos };
}

/** Cómo van los envíos: el diálogo pregunta hasta que todos terminan (o se cansa y manda a Despachos). */
export async function estadoCompartido(ids: string[]): Promise<Record<string, { estado: string; error: string | null }>> {
    await exigir();
    const filas = await prisma.dispatchJob.findMany({ where: { id: { in: (ids || []).slice(0, DESTINOS_MAX) } }, select: { id: true, status: true, lastError: true } });
    return Object.fromEntries(filas.map((f) => [f.id, { estado: f.status, error: f.lastError }]));
}
