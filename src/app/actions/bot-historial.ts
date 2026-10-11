"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";

/**
 * El historial del bot de WhatsApp como conversaciones, no como tabla.
 *
 * WahaRequestLog guarda una fila por mensaje recibido: quién (fromNumber), qué escribió
 * (messageBody), qué pasó (status: OK | IGNORADO) y qué contestó el bot o por qué no
 * contestó (responseDetails). La tabla de Ajustes mostraba eso como 50 renglones sueltos; acá
 * se agrupa por número y se cruza con las fichas para saber quién es — con la misma regla
 * del bot: los últimos 8 dígitos.
 *
 * "status" no es un número: son los estados (historias) de WhatsApp que llegan al webhook.
 * El bot los ignora siempre; se separan para que no llenen la lista.
 */

const ESTADOS_WHATSAPP = "status";
/** Cuántas conversaciones y cuántos mensajes por conversación se traen. */
const CONVERSACIONES_MAX = 60;
const MENSAJES_MAX = 120;

const cola8 = (n: string | null | undefined) => String(n || "").replace(/\D/g, "").slice(-8);

export type Conversacion = {
    numero: string; esEstados: boolean;
    nombre: string | null; rol: string | null; foto: string | null; lote: string | null;
    ultimo: { texto: string; ts: string; estado: string };
    total: number; ignorados: number;
};
export type MensajeBot = { id: string; ts: string; texto: string; estado: string; respuesta: string | null };

async function quienEs(numeros: string[]) {
    const colas = new Set(numeros.map(cola8).filter(Boolean));
    if (!colas.size) return new Map<string, { nombre: string; rol: string; foto: string | null; lote: string | null }>();
    const usuarios = await prisma.user.findMany({ where: { phone: { not: null } }, select: { name: true, role: true, phone: true, cara: true, unit: { select: { name: true } } } });
    const m = new Map<string, { nombre: string; rol: string; foto: string | null; lote: string | null }>();
    for (const u of usuarios) {
        const c = cola8(u.phone);
        if (c && colas.has(c) && !m.has(c)) m.set(c, { nombre: u.name, rol: String(u.role), foto: u.cara || null, lote: u.unit?.name || null });
    }
    return m;
}

export async function conversacionesBot(): Promise<{ ok: true; conversaciones: Conversacion[] } | { ok: false; error: string }> {
    if (!(await getSession())) return { ok: false, error: "Hace falta una sesión del panel." };
    const grupos = await prisma.wahaRequestLog.groupBy({
        by: ["fromNumber"], _count: { _all: true }, _max: { timestamp: true },
        orderBy: { _max: { timestamp: "desc" } }, take: CONVERSACIONES_MAX,
    });
    const numeros = grupos.map((g) => g.fromNumber);
    const [ultimos, ignorados, personas] = await Promise.all([
        Promise.all(grupos.map((g) => prisma.wahaRequestLog.findFirst({ where: { fromNumber: g.fromNumber }, orderBy: { timestamp: "desc" } }))),
        prisma.wahaRequestLog.groupBy({ by: ["fromNumber"], where: { fromNumber: { in: numeros }, status: "IGNORADO" }, _count: { _all: true } }),
        quienEs(numeros.filter((n) => n !== ESTADOS_WHATSAPP)),
    ]);
    const ign = new Map(ignorados.map((g) => [g.fromNumber, g._count._all]));
    return {
        ok: true,
        conversaciones: grupos.map((g, i) => {
            const u = ultimos[i];
            const p = personas.get(cola8(g.fromNumber));
            return {
                numero: g.fromNumber, esEstados: g.fromNumber === ESTADOS_WHATSAPP,
                nombre: p?.nombre || null, rol: p?.rol || null, foto: p?.foto || null, lote: p?.lote || null,
                ultimo: { texto: u?.messageBody || "", ts: (u?.timestamp || g._max.timestamp || new Date()).toISOString(), estado: u?.status || "" },
                total: g._count._all, ignorados: ign.get(g.fromNumber) || 0,
            };
        }),
    };
}

export async function mensajesBot(numero: string): Promise<{ ok: true; mensajes: MensajeBot[] } | { ok: false; error: string }> {
    if (!(await getSession())) return { ok: false, error: "Hace falta una sesión del panel." };
    const filas = await prisma.wahaRequestLog.findMany({ where: { fromNumber: numero }, orderBy: { timestamp: "desc" }, take: MENSAJES_MAX });
    return {
        ok: true,
        mensajes: filas.reverse().map((f) => ({ id: f.id, ts: f.timestamp.toISOString(), texto: f.messageBody, estado: f.status, respuesta: f.responseDetails })),
    };
}
