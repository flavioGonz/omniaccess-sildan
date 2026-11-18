import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";

/**
 * Mandar un correo desde OmniAccess.
 *
 * No existía: `nodemailer` estaba en las dependencias y no lo usaba nadie («Email would need SMTP
 * config - placeholder for now», en notifications.ts). Hizo falta para el censo con clave por lote
 * (18/11): un correo por lote con copia a la administración, y esa copia es la prueba de que el
 * registro se mandó.
 *
 * La configuración vive en Settings, como todo lo demás. `SMTP_PASSWORD` lleva esa palabra a
 * propósito: `lib/ajustes-secretos` marca como secreta toda clave que la tenga, así que sólo la
 * lee quien tiene permiso de Ajustes.
 */

export const CLAVES_SMTP = ["SMTP_HOST", "SMTP_PORT", "SMTP_SEGURO", "SMTP_USUARIO", "SMTP_PASSWORD", "SMTP_DESDE", "SMTP_COPIA"] as const;

export type ConfigCorreo = {
    host: string; puerto: number; seguro: boolean;
    usuario: string; clave: string;
    /** Lo que ve quien recibe: «OmniAccess <censo@barrio.com>». */
    desde: string;
    /** Copia fija de todo lo que se manda (la administración). Vacío = sin copia. */
    copia: string;
};

export async function configCorreo(): Promise<ConfigCorreo | null> {
    const filas = await prisma.setting.findMany({ where: { key: { in: [...CLAVES_SMTP] } } }).catch(() => []);
    const m = Object.fromEntries(filas.map((f) => [f.key, f.value || ""]));
    const host = (m.SMTP_HOST || "").trim();
    if (!host) return null;
    const puerto = Number(m.SMTP_PORT) || 587;
    return {
        host, puerto,
        // 465 es TLS desde el saludo; 587 arranca en claro y sube con STARTTLS. Elegirlo mal es
        // el motivo número uno de «se queda colgado al mandar».
        seguro: m.SMTP_SEGURO ? m.SMTP_SEGURO === "true" : puerto === 465,
        usuario: (m.SMTP_USUARIO || "").trim(),
        clave: m.SMTP_PASSWORD || "",
        desde: (m.SMTP_DESDE || m.SMTP_USUARIO || "").trim(),
        copia: (m.SMTP_COPIA || "").trim(),
    };
}

export type Envio = { para: string; copia?: string; asunto: string; texto: string; html?: string };

/**
 * Manda uno. Nunca tira: devuelve por qué no se pudo, porque quien lo llama está mandando
 * trescientos y uno que falla no puede cortar los otros doscientos noventa y nueve.
 */
export async function enviarCorreo(e: Envio): Promise<{ ok: boolean; error?: string }> {
    const cfg = await configCorreo();
    if (!cfg) return { ok: false, error: "Falta configurar el servidor de correo (Ajustes → Correo)." };
    if (!cfg.desde) return { ok: false, error: "Falta el remitente (SMTP_DESDE)." };
    try {
        const t = nodemailer.createTransport({
            host: cfg.host, port: cfg.puerto, secure: cfg.seguro,
            auth: cfg.usuario ? { user: cfg.usuario, pass: cfg.clave } : undefined,
            // Un servidor que no contesta en quince segundos no va a contestar: mejor fallar y
            // reintentar esa fila que dejar la cola entera esperando.
            connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000,
        });
        const copias = [cfg.copia, e.copia].filter(Boolean).join(", ");
        await t.sendMail({ from: cfg.desde, to: e.para, cc: copias || undefined, subject: e.asunto, text: e.texto, html: e.html });
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "No se pudo mandar" };
    }
}

/** Probar la configuración sin mandarle nada a nadie: saluda al servidor y se va. */
export async function probarCorreo(): Promise<{ ok: boolean; error?: string }> {
    const cfg = await configCorreo();
    if (!cfg) return { ok: false, error: "Falta configurar el servidor de correo." };
    try {
        const t = nodemailer.createTransport({
            host: cfg.host, port: cfg.puerto, secure: cfg.seguro,
            auth: cfg.usuario ? { user: cfg.usuario, pass: cfg.clave } : undefined,
            connectionTimeout: 12_000, greetingTimeout: 12_000,
        });
        await t.verify();
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "No contestó" };
    }
}
