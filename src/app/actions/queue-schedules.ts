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
