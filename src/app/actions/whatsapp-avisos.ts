"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

/**
 * Avisos salientes por WhatsApp — los interruptores de Ajustes → WhatsApp.
 *
 * No son un mecanismo aparte: cada interruptor es UNA regla del motor de notificaciones
 * (/admin/notificaciones) con id fijo, canal whatsapp y sin cámara (todas). Así lo que se
 * prende acá se ve y se afina allá (horario, cámara, antirrebote), y no hay dos lugares
 * que digan cosas distintas sobre si el barrio recibe alertas o no.
 */

export type TipoAviso = "INTRUSION" | "LPR";

const REGLA: Record<TipoAviso, { id: string; name: string; modulo: string; eventos: string; cooldownSec: number }> = {
    // Intrusión: todos los eventos; 20 s de antirrebote porque un cruce real dispara varias
    // veces seguidas y el guardia no necesita cinco WhatsApp del mismo auto.
    INTRUSION: { id: "regla-intrusion-wa", name: "Intrusión → WhatsApp", modulo: "INTRUSION", eventos: "", cooldownSec: 20 },
    // LPR: por defecto sólo lo que merece un aviso (denegados y desconocidos); los permitidos
    // serían un mensaje por cada auto del barrio. Se puede cambiar desde Notificaciones.
    LPR: { id: "regla-lpr-wa", name: "Eventos LPR → WhatsApp", modulo: "LPR", eventos: "DENY,UNKNOWN", cooldownSec: 0 },
};

type Destinatario = { id: string; name: string; channel: string; address: string; enabled?: boolean };

async function leerDestinatarios(): Promise<Destinatario[]> {
    try {
        const s = await prisma.setting.findUnique({ where: { key: "DISPATCH_RECIPIENTS" } });
        const arr = JSON.parse(s?.value || "[]");
        return Array.isArray(arr) ? arr : [];
    } catch { return []; }
}

async function guardarDestinatarios(lista: Destinatario[]) {
    const value = JSON.stringify(lista);
    await prisma.setting.upsert({ where: { key: "DISPATCH_RECIPIENTS" }, update: { value }, create: { key: "DISPATCH_RECIPIENTS", value } });
}

export async function getAvisosWhatsApp() {
    const reglas = await prisma.notificationRule.findMany({ where: { id: { in: Object.values(REGLA).map((r) => r.id) } } });
    const porId = new Map(reglas.map((r) => [r.id, r]));
    const estado = (t: TipoAviso) => {
        const r = porId.get(REGLA[t].id);
        return { enabled: !!r?.enabled, eventos: r?.eventos ?? REGLA[t].eventos, existe: !!r };
    };
    const destinatarios = (await leerDestinatarios()).filter((d) => d.channel === "whatsapp");
    return { intrusion: estado("INTRUSION"), lpr: estado("LPR"), destinatarios };
}

export async function setAvisoWhatsApp(tipo: TipoAviso, enabled: boolean, eventos?: string) {
    const def = REGLA[tipo];
    try {
        await prisma.notificationRule.upsert({
            where: { id: def.id },
            update: { enabled, ...(eventos !== undefined ? { eventos } : {}) },
            create: { id: def.id, name: def.name, enabled, modulo: def.modulo, eventos: eventos ?? def.eventos, channels: "whatsapp", cooldownSec: def.cooldownSec, dedupe: true },
        });
        revalidatePath("/admin/notificaciones");
        return { ok: true };
    } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
}

/** Alta de un número que recibe los avisos (personal/garita). Se guarda sin formato: sólo dígitos. */
export async function agregarDestinatarioWhatsApp(numero: string, nombre?: string) {
    const digitos = String(numero || "").replace(/\D/g, "");
    if (digitos.length < 8) return { ok: false, error: "Número incompleto" };
    // Uruguay: 09x xxx xxx → 598 9x xxx xxx. Si ya viene con país, se respeta.
    const completo = digitos.startsWith("598") ? digitos : digitos.startsWith("0") ? "598" + digitos.slice(1) : digitos;
    const lista = await leerDestinatarios();
    if (lista.some((d) => d.channel === "whatsapp" && d.address.replace(/\D/g, "") === completo)) return { ok: true, repetido: true };
    lista.push({ id: `wa-${completo}`, name: (nombre || "").trim() || completo, channel: "whatsapp", address: completo, enabled: true });
    await guardarDestinatarios(lista);
    return { ok: true };
}

export async function quitarDestinatarioWhatsApp(id: string) {
    const lista = await leerDestinatarios();
    await guardarDestinatarios(lista.filter((d) => d.id !== id));
    return { ok: true };
}
