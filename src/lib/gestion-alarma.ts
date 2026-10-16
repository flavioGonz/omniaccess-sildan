import { prisma } from "@/lib/prisma";
import { avisarPorSocket } from "@/lib/avisar";

/**
 * Quién opera cada alarma y la bitácora de lo que se hizo (16/10, Nico: «cuando un usuario toma
 * una alerta, debe quedar registrado en el evento qué usuario está operando esa alerta en vivo, y
 * tener un historial claro de este manejo de alertas»).
 *
 * Dos cosas distintas:
 *  · el OPERADOR — quién la tiene ahora (AlarmaAtendida.operador). Tomarla avisa a las demás
 *    pantallas por socket, para que otro compañero no la atienda a la vez; pasarla la deja libre.
 *  · la BITÁCORA — cada cosa que alguien hizo, con quién y cuándo (AlarmaGestion). No se borra:
 *    es lo que se mira después para saber cómo se manejó.
 */

import type { AccionGestion, PasoGestion, Operador } from "@/lib/gestion-alarma-texto";
export type { AccionGestion, PasoGestion, Operador } from "@/lib/gestion-alarma-texto";

export async function registrarGestion(clave: string, accion: AccionGestion, por: string | null, extra: { deviceId?: string | null; detalle?: string | null } = {}) {
    try {
        await prisma.alarmaGestion.create({ data: { clave, accion, por, deviceId: extra.deviceId || null, detalle: extra.detalle ? extra.detalle.slice(0, 500) : null } });
        avisarPorSocket("alarma_gestion", { clave, accion, por });
    } catch (e: any) { console.error("[gestion-alarma]", e?.message || e); }
}

/** La clave de la intrusión en curso de una cámara: su última detección aceptada como real. */
export async function claveIntrusion(deviceId: string): Promise<string> {
    const d = await prisma.detection.findFirst({ where: { deviceId, acknowledged: true, ackKind: "real", type: { not: "MOTION" } }, orderBy: { timestamp: "desc" }, select: { id: true } }).catch(() => null);
    return d ? `d:${d.id}` : `c:${deviceId}`;
}

export async function operadoresDe(claves: string[]): Promise<Record<string, Operador>> {
    if (!claves.length) return {};
    const filas = await prisma.alarmaAtendida.findMany({ where: { clave: { in: claves } }, select: { clave: true, operador: true, operadorDesde: true } }).catch(() => []);
    return Object.fromEntries(filas.map((f) => [f.clave, { operador: f.operador, desde: f.operadorDesde?.toISOString() || null }]));
}

/** Tomarla: queda a nombre de `por`. Si la tenía otro, se dice en la bitácora. */
export async function tomarAlarma(clave: string, por: string, deviceId?: string | null): Promise<Operador> {
    const previa = await prisma.alarmaAtendida.findUnique({ where: { clave }, select: { operador: true } }).catch(() => null);
    if (previa?.operador === por) return (await operadoresDe([clave]))[clave];
    const ahora = new Date();
    await prisma.alarmaAtendida.upsert({
        where: { clave }, update: { operador: por, operadorDesde: ahora },
        create: { clave, atendida: false, operador: por, operadorDesde: ahora, por },
    });
    await registrarGestion(clave, "TOMO", por, { deviceId, detalle: previa?.operador ? `se la tomó a ${previa.operador}` : null });
    return { operador: por, desde: ahora.toISOString() };
}

/** Pasarla: queda libre para que la tome otro compañero, con lo que quiera dejar dicho. */
export async function pasarAlarma(clave: string, por: string | null, nota?: string | null, deviceId?: string | null) {
    await prisma.alarmaAtendida.updateMany({ where: { clave }, data: { operador: null, operadorDesde: null } });
    await registrarGestion(clave, "PASO", por, { deviceId, detalle: nota || null });
}

export async function historialGestion(clave: string): Promise<{ pasos: PasoGestion[]; operador: Operador }> {
    const [filas, op] = await Promise.all([
        prisma.alarmaGestion.findMany({ where: { clave }, orderBy: { ts: "asc" }, take: 200 }).catch(() => []),
        operadoresDe([clave]),
    ]);
    return {
        pasos: filas.map((f) => ({ id: f.id, accion: f.accion as AccionGestion, por: f.por, detalle: f.detalle, ts: f.ts.toISOString() })),
        operador: op[clave] || { operador: null, desde: null },
    };
}
