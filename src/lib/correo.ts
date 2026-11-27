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

/**
 * Una cuenta propia desde la que se manda (25/11): la de una administración del complejo. San Nicolás
 * tiene cuatro comisiones y cada una le escribe a sus lotes desde su casilla de Gmail, con su clave de
 * aplicación. Gmail es fijo (smtp.gmail.com, 465 con TLS): las cuatro son Gmail y pedirle a quien la
 * carga servidor y puerto es pedirle que se equivoque.
 */
export type CuentaCorreo = { cuenta: string; clave: string; nombre?: string | null };
const GMAIL = { host: "smtp.gmail.com", port: 465, secure: true } as const;
/** La clave de aplicación de Gmail se muestra en cuatro grupos («abcd efgh …»): los espacios no son parte de ella. */
export const limpiarClaveDeAplicacion = (c: string) => String(c || "").replace(/\s+/g, "");

/**
 * La copia fija de todo lo que se manda (Ajustes › Correo › Copia), leída aparte: con cuentas por
 * administración puede no haber servidor general, y la copia tiene que ir igual. Admite varias,
 * separadas por coma (25/11: María y Flavio).
 */
export async function copiaFija(): Promise<string> {
    const f = await prisma.setting.findUnique({ where: { key: "SMTP_COPIA" } }).catch(() => null);
    return (f?.value || "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean).join(", ");
}

export type Envio = {
    para: string; copia?: string; asunto: string; texto: string; html?: string;
    /** Imágenes que el HTML cita como `cid:<cid>` (el logo). Viajan adentro del correo, no como adjunto a bajar. */
    enLinea?: { cid: string; nombre: string; contenido: Buffer }[];
    /** Archivos adjuntos para bajar (27/11: el manual del residente en el correo del censo). */
    adjuntos?: { nombre: string; contenido: Buffer; tipo?: string }[];
};

/**
 * Manda uno. Nunca tira: devuelve por qué no se pudo, porque quien lo llama está mandando
 * trescientos y uno que falla no puede cortar los otros doscientos noventa y nueve.
 */
export async function enviarCorreo(e: Envio, o: { desde?: CuentaCorreo | null; sinCopia?: boolean } = {}): Promise<{ ok: boolean; error?: string; desde?: string }> {
    /* Desde una cuenta propia (la de una administración) o desde el servidor general. */
    let transporte: Parameters<typeof nodemailer.createTransport>[0];
    let remitente: string, cuenta: string;
    if (o.desde) {
        transporte = { ...GMAIL, auth: { user: o.desde.cuenta, pass: limpiarClaveDeAplicacion(o.desde.clave) } };
        remitente = o.desde.nombre ? `"${o.desde.nombre.replace(/"/g, "")}" <${o.desde.cuenta}>` : o.desde.cuenta;
        cuenta = o.desde.cuenta;
    } else {
        const cfg = await configCorreo();
        if (!cfg) return { ok: false, error: "Falta configurar el servidor de correo (Ajustes → Correo)." };
        if (!cfg.desde) return { ok: false, error: "Falta el remitente (SMTP_DESDE)." };
        transporte = { host: cfg.host, port: cfg.puerto, secure: cfg.seguro, auth: cfg.usuario ? { user: cfg.usuario, pass: cfg.clave } : undefined };
        remitente = cfg.desde;
        cuenta = cfg.usuario || cfg.desde;
    }
    try {
        const t = nodemailer.createTransport({
            ...(transporte as object),
            // Un servidor que no contesta en quince segundos no va a contestar: mejor fallar y
            // reintentar esa fila que dejar la cola entera esperando.
            connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000,
        });
        /* La copia fija va en todo, y cuando sale de la cuenta de una administración la propia cuenta
           también (25/11, Nico: «no son IMAP, deben tener una copia en el mail»). */
        /* Las copias van OCULTAS (25/11, Nico: «sólo el remitente de cada administración debe estar en
           copia oculta, igual que flaviogonzalezdesign@gmail.com; cada administración recibirá una copia
           de lo enviado en copia oculta»). El vecino ve un correo de su administración para él, sin
           direcciones de terceros a la vista; la casilla que manda y la copia fija lo reciben igual.
           La copia que pide quien llama (`e.copia`) sí va a la vista: es parte del mensaje. */
        const limpias = (xs: unknown[]) => [...new Set(xs.flatMap((x) => String(x || "").split(/[,;\s]+/)).map((x) => x.trim().toLowerCase())
            .filter((x) => x && x.includes("@") && x !== e.para.trim().toLowerCase()))];
        const visibles = limpias([e.copia]);
        const ocultas = limpias([...(o.sinCopia ? [] : [await copiaFija()]), o.desde?.cuenta]).filter((x) => !visibles.includes(x));
        await t.sendMail({
            from: remitente, to: e.para, cc: visibles.join(", ") || undefined, bcc: ocultas.join(", ") || undefined, subject: e.asunto, text: e.texto, html: e.html,
            attachments: [
                ...(e.enLinea || []).map((a) => ({ filename: a.nombre, content: a.contenido, cid: a.cid, contentDisposition: "inline" as const })),
                ...(e.adjuntos || []).map((a) => ({ filename: a.nombre, content: a.contenido, contentType: a.tipo, contentDisposition: "attachment" as const })),
            ],
        });
        return { ok: true, desde: cuenta };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "No se pudo mandar" };
    }
}

/** Probar una cuenta propia sin mandarle nada a nadie: Gmail dice si acepta la cuenta y la clave. */
export async function probarCuenta(c: CuentaCorreo): Promise<{ ok: boolean; error?: string }> {
    try {
        const t = nodemailer.createTransport({ ...GMAIL, auth: { user: c.cuenta, pass: limpiarClaveDeAplicacion(c.clave) }, connectionTimeout: 12_000, greetingTimeout: 12_000 });
        await t.verify();
        return { ok: true };
    } catch (err) {
        const m = err instanceof Error ? err.message : "No contestó";
        /* El rechazo más común tiene una causa conocida: se cargó la clave de la cuenta y no una de aplicación. */
        if (/535|Username and Password not accepted|BadCredentials/i.test(m)) return { ok: false, error: "Gmail no aceptó la cuenta con esa clave. Tiene que ser una clave de aplicación (16 letras), no la clave de la cuenta, y la cuenta tiene que tener la verificación en dos pasos prendida." };
        return { ok: false, error: m.slice(0, 200) };
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
