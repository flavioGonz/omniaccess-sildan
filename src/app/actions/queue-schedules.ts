"use server";

import { prisma } from "@/lib/prisma";
import { resetQueueCounters } from "@/lib/onvif-polling";

export async function getQueueSchedules() {
    return prisma.queueSchedule.findMany({ orderBy: { createdAt: "asc" } });
}

export async function createQueueSchedule(data: {
    name: string; deviceId?: string | null; daysOfWeek: string;
    openTime: string; closeTime: string; resetOnOpen?: boolean; enabled?: boolean;
}) {
    return prisma.queueSchedule.create({
        data: {
            name: data.name,
            deviceId: data.deviceId || null,
            daysOfWeek: data.daysOfWeek,
            openTime: data.openTime,
            closeTime: data.closeTime,
            resetOnOpen: data.resetOnOpen ?? true,
            enabled: data.enabled ?? true,
        },
    });
}

export async function updateQueueSchedule(id: string, data: any) {
    return prisma.queueSchedule.update({ where: { id }, data });
}

export async function deleteQueueSchedule(id: string) {
    return prisma.queueSchedule.delete({ where: { id } });
}

// Manual reset (used by the "Reset ahora" button)
export async function runQueueReset(deviceId?: string | null) {
    const devices = deviceId
        ? await prisma.device.findMany({ where: { id: deviceId }, select: { id: true } })
        : await prisma.device.findMany({ where: { deviceType: "QUEUE_COUNTER" }, select: { id: true } });
    const now = new Date();
    for (const d of devices) {
        try { resetQueueCounters(d.id); } catch {}
        for (const ch of ["Aforo", "Entrada", "Salida"]) {
            await prisma.queueEvent.create({
                data: { deviceId: d.id, channelName: ch, channelId: 1, peopleCount: 0, timestamp: now, metadata: JSON.stringify({ source: "manual_reset" }) },
            });
        }
    }
    return { reset: devices.length };
}

/* ── Días especiales (feriados u horario distinto) ── */
export async function getDiasEspeciales(desde?: string, hasta?: string) {
    const where: any = {};
    if (desde || hasta) where.fecha = { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) };
    return prisma.queueDiaEspecial.findMany({ where, orderBy: { fecha: "asc" } });
}

const FECHA_RX = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RX = /^\d{2}:\d{2}$/;

export async function guardarDiaEspecial(data: { id?: string; fecha: string; deviceId?: string | null; cerrada: boolean; openTime?: string | null; closeTime?: string | null; nota?: string | null }) {
    if (!FECHA_RX.test(data.fecha)) throw new Error("Fecha inválida");
    if (!data.cerrada && (!HORA_RX.test(data.openTime || "") || !HORA_RX.test(data.closeTime || ""))) throw new Error("Falta el horario de ese día");
    const datos = {
        fecha: data.fecha, deviceId: data.deviceId || null, cerrada: data.cerrada,
        openTime: data.cerrada ? null : data.openTime, closeTime: data.cerrada ? null : data.closeTime, nota: data.nota?.trim() || null,
    };
    return data.id ? prisma.queueDiaEspecial.update({ where: { id: data.id }, data: datos }) : prisma.queueDiaEspecial.create({ data: datos });
}

export async function borrarDiaEspecial(id: string) {
    return prisma.queueDiaEspecial.delete({ where: { id } });
}
