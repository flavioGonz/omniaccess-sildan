"use server";

import { prisma } from "@/lib/prisma";

// ─── Channel CRUD ──────────────────────────────────
export async function getNotificationChannels() {
    return prisma.notificationChannel.findMany({
        orderBy: { createdAt: "desc" },
    });
}

export async function createNotificationChannel(data: {
    name: string;
    type: string;
    config: string;
    enabled?: boolean;
}) {
    return prisma.notificationChannel.create({ data });
}

export async function updateNotificationChannel(id: string, data: {
    name?: string;
    config?: string;
    enabled?: boolean;
}) {
    return prisma.notificationChannel.update({ where: { id }, data });
}

export async function deleteNotificationChannel(id: string) {
    return prisma.notificationChannel.delete({ where: { id } });
}

// ─── Test a channel ────────────────────────────────
export async function testNotificationChannel(id: string) {
    const channel = await prisma.notificationChannel.findUnique({ where: { id } });
    if (!channel) throw new Error("Canal no encontrado");

    const message = `✅ Test de OmniAccess — Canal "${channel.name}" configurado correctamente.`;
    return sendNotification(channel, message, "TEST");
}

// ─── Send notification via channel ─────────────────
async function sendNotification(
    channel: { id: string; type: string; config: string; name: string },
    message: string,
    alertId?: string
) {
    const config = JSON.parse(channel.config);
    let status = "SENT";
    let error: string | null = null;

    try {
        if (channel.type === "TELEGRAM") {
            const url = `https://api.telegram.org/bot${config.token}/sendMessage`;
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: config.chatId,
                    text: message,
                    parse_mode: "HTML",
                }),
            });
            if (!res.ok) {
                const body = await res.text();
                throw new Error(`Telegram API error ${res.status}: ${body}`);
            }
        } else if (channel.type === "WEBHOOK") {
            const res = await fetch(config.url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ source: "OmniAccess", message, timestamp: new Date().toISOString() }),
            });
            if (!res.ok) throw new Error(`Webhook error ${res.status}`);
        } else if (channel.type === "SLACK") {
            const res = await fetch(config.webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: message }),
            });
            if (!res.ok) throw new Error(`Slack error ${res.status}`);
        } else if (channel.type === "EMAIL") {
            // Email would need SMTP config - placeholder for now
            status = "PENDING";
            error = "Email no configurado aún";
        }
    } catch (e: any) {
        status = "FAILED";
        error = e.message || "Error desconocido";
    }

    // Log the notification
    await prisma.notificationLog.create({
        data: {
            channelId: channel.id,
            alertId: alertId || null,
            message,
            status,
            error,
        },
    });

    return { status, error };
}

// ─── Fire alert notifications ──────────────────────
export async function fireAlertNotification(alertName: string, deviceName: string, channel: string, count: number, threshold: number) {
    const channels = await prisma.notificationChannel.findMany({
        where: { enabled: true },
    });

    const message = `🚨 <b>Alerta de Fila — ${alertName}</b>\n\n` +
        `📍 Dispositivo: ${deviceName}\n` +
        `📺 Canal: ${channel}\n` +
        `👥 Personas: <b>${count}</b> (umbral: ${threshold})\n` +
        `🕐 ${new Date().toLocaleString("es-UY", { timeZone: "America/Montevideo" })}`;

    const results = [];
    for (const ch of channels) {
        const result = await sendNotification(ch, message, alertName);
        results.push({ channel: ch.name, ...result });
    }
    return results;
}

// ─── Notification logs ─────────────────────────────
export async function getNotificationLogs(options?: {
    take?: number;
    channelId?: string;
    status?: string;
    from?: Date;
    to?: Date;
}) {
    const where: any = {};
    if (options?.channelId) where.channelId = options.channelId;
    if (options?.status) where.status = options.status;
    if (options?.from || options?.to) {
        where.createdAt = {};
        if (options?.from) where.createdAt.gte = options.from;
        if (options?.to) where.createdAt.lte = options.to;
    }

    const [logs, total] = await Promise.all([
        prisma.notificationLog.findMany({
            where,
            take: options?.take ?? 100,
            orderBy: { createdAt: "desc" },
            include: { channel: { select: { name: true, type: true } } },
        }),
        prisma.notificationLog.count({ where }),
    ]);

    return { logs, total };
}

// ─── Queue Reports Data ────────────────────────────
export async function getQueueReportData(options: {
    from: string;
    to: string;
    deviceId?: string;
}) {
    const from = new Date(options.from);
    const to = new Date(options.to);
    to.setHours(23, 59, 59, 999);

    const where: any = {
        timestamp: { gte: from, lte: to },
    };
    if (options.deviceId) where.deviceId = options.deviceId;

    // Get events grouped by day and hour
    const events = await prisma.queueEvent.findMany({
        where,
        select: {
            timestamp: true,
            peopleCount: true,
            channelName: true,
            deviceId: true,
            device: { select: { name: true } },
        },
        orderBy: { timestamp: "asc" },
    });

    // Get alerts fired in period
    const alertsFired = await prisma.notificationLog.findMany({
        where: {
            createdAt: { gte: from, lte: to },
            status: "SENT",
        },
        select: {
            createdAt: true,
            message: true,
            channel: { select: { name: true, type: true } },
        },
        orderBy: { createdAt: "desc" },
    });

    // Aggregate by day
    const dailyMap = new Map<string, { date: string; total: number; avg: number; max: number; count: number; alerts: number }>();
    
    for (const ev of events) {
        const day = new Date(ev.timestamp).toISOString().split("T")[0];
        const existing = dailyMap.get(day) || { date: day, total: 0, avg: 0, max: 0, count: 0, alerts: 0 };
        existing.total += ev.peopleCount;
        existing.max = Math.max(existing.max, ev.peopleCount);
        existing.count += 1;
        dailyMap.set(day, existing);
    }

    // Calculate averages
    for (const [, val] of dailyMap) {
        val.avg = Math.round((val.total / val.count) * 10) / 10;
    }

    // Count alerts per day
    for (const alert of alertsFired) {
        const day = new Date(alert.createdAt).toISOString().split("T")[0];
        const existing = dailyMap.get(day);
        if (existing) existing.alerts += 1;
    }

    // Hourly breakdown for the full period
    const hourlyMap = new Map<number, { total: number; max: number; count: number }>();
    for (let h = 0; h < 24; h++) hourlyMap.set(h, { total: 0, max: 0, count: 0 });

    for (const ev of events) {
        const hour = new Date(ev.timestamp).getHours();
        const entry = hourlyMap.get(hour)!;
        entry.total += ev.peopleCount;
        entry.max = Math.max(entry.max, ev.peopleCount);
        entry.count += 1;
    }

    const hourlyBreakdown = Array.from(hourlyMap.entries()).map(([hour, data]) => ({
        hour,
        avg: data.count > 0 ? Math.round((data.total / data.count) * 10) / 10 : 0,
        max: data.max,
        count: data.count,
    }));

    return {
        summary: {
            totalEvents: events.length,
            avgCount: events.length > 0 ? Math.round((events.reduce((s, e) => s + e.peopleCount, 0) / events.length) * 10) / 10 : 0,
            maxCount: events.length > 0 ? Math.max(...events.map(e => e.peopleCount)) : 0,
            totalAlerts: alertsFired.length,
            daysWithData: dailyMap.size,
        },
        daily: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
        hourly: hourlyBreakdown,
        recentAlerts: alertsFired.slice(0, 20),
    };
}
