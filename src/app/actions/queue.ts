"use server";

import { prisma } from "@/lib/prisma";

// --- Get Queue Events (history) ---
export async function getQueueEvents(options?: {
    take?: number;
    skip?: number;
    deviceId?: string;
    channelName?: string;
    from?: Date;
    to?: Date;
    minCount?: number;
}) {
    const where: any = {};

    if (options?.deviceId) where.deviceId = options.deviceId;
    if (options?.channelName) where.channelName = options.channelName;
    if (options?.minCount) where.peopleCount = { gte: options.minCount };

    if (options?.from || options?.to) {
        where.timestamp = {};
        if (options?.from) where.timestamp.gte = options.from;
        if (options?.to) where.timestamp.lte = options.to;
    }

    const [events, total] = await Promise.all([
        prisma.queueEvent.findMany({
            where,
            take: options?.take ?? 50,
            skip: options?.skip ?? 0,
            orderBy: { timestamp: "desc" },
            include: { device: true },
        }),
        prisma.queueEvent.count({ where }),
    ]);

    return { events, total };
}

// --- Get latest count per channel (live view) ---
export async function getLatestQueueCounts() {
    const devices = await prisma.device.findMany({
        where: { deviceType: "QUEUE_COUNTER" },
        select: { id: true, name: true, ip: true, location: true, brand: true },
    });

    if (devices.length === 0) return [];

    const results = [];

    for (const device of devices) {
        const latestEvents = await prisma.$queryRaw<
            { channelName: string; channelId: number; peopleCount: number; timestamp: Date; snapshotPath: string | null }[]
        >`
            SELECT DISTINCT ON ("channelName")
                "channelName", "channelId", "peopleCount", "timestamp", "snapshotPath"
            FROM "QueueEvent"
            WHERE "deviceId" = ${device.id}
            ORDER BY "channelName", "timestamp" DESC
        `;

        // Solo canales ACTIVOS: descarta nombres de canal viejos/de configs anteriores que ya no
        // reporta la cámara (los reales actualizan juntos; los obsoletos quedaron horas/días atrás).
        const deviceLatestMs = latestEvents.reduce((m, e) => Math.max(m, new Date(e.timestamp).getTime()), 0);
        const ACTIVE_WINDOW_MS = 6 * 60 * 60 * 1000;
        const activeEvents = deviceLatestMs > 0
            ? latestEvents.filter(e => deviceLatestMs - new Date(e.timestamp).getTime() <= ACTIVE_WINDOW_MS)
            : latestEvents;

        // Live aforo: mirror exactly what the camera's OccupancyCounter sends (1 -> 1, 0 -> 0).
        // No app-side hold/smoothing. Stability is handled at the camera (VCA "Tiempo de rebote").
        results.push({
            device,
            channels: activeEvents.map(e => ({
                channelName: e.channelName || `Canal ${e.channelId}`,
                channelId: e.channelId,
                peopleCount: e.peopleCount,
                lastUpdate: e.timestamp,
                snapshotPath: e.snapshotPath,
            })),
        });
    }

    return results;
}

// --- Get today's queue stats ---
export async function getQueueStatsToday() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [totalEvents, avgCount, maxCount, alertsFired] = await Promise.all([
        prisma.queueEvent.count({
            where: { timestamp: { gte: startOfDay } },
        }),
        prisma.queueEvent.aggregate({
            where: { timestamp: { gte: startOfDay } },
            _avg: { peopleCount: true },
        }),
        prisma.queueEvent.aggregate({
            where: { timestamp: { gte: startOfDay } },
            _max: { peopleCount: true },
        }),
        prisma.queueAlert.count({
            where: {
                lastFiredAt: { gte: startOfDay },
            },
        }),
    ]);

    return {
        totalEvents,
        avgCount: Math.round((avgCount._avg.peopleCount || 0) * 10) / 10,
        maxCount: maxCount._max.peopleCount || 0,
        alertsFired,
    };
}

// --- Get hourly breakdown for chart ---
// Uruguay = UTC-3 (sin horario de verano). El server corre en UTC.
const UY_OFFSET_MS = 3 * 60 * 60 * 1000;
function uyHour(ts: Date | string): number { return new Date(new Date(ts).getTime() - UY_OFFSET_MS).getUTCHours(); }
function uyMinuteOfDay(ts: Date | string): number { const s = new Date(new Date(ts).getTime() - UY_OFFSET_MS); return s.getUTCHours() * 60 + s.getUTCMinutes(); }
function uyDayWindow(target: Date): { start: Date; end: Date } {
    const s = new Date(target.getTime() - UY_OFFSET_MS);
    const startMs = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate(), 0, 0, 0) + UY_OFFSET_MS;
    return { start: new Date(startMs), end: new Date(startMs + 24 * 60 * 60 * 1000 - 1) };
}

export async function getQueueHourlyBreakdown(deviceId?: string, date?: Date) {
    const targetDate = date || new Date();
    const { start: startOfDay, end: endOfDay } = uyDayWindow(targetDate);

    const where: any = {
        timestamp: { gte: startOfDay, lte: endOfDay },
    };
    if (deviceId) where.deviceId = deviceId;

    const events = await prisma.queueEvent.findMany({
        where,
        select: { timestamp: true, peopleCount: true },
        orderBy: { timestamp: "asc" },
    });

    const hourly: { hour: number; avg: number; max: number; count: number }[] = [];
    for (let h = 0; h < 24; h++) {
        const hourEvents = events.filter(e => uyHour(e.timestamp) === h);
        if (hourEvents.length === 0) {
            hourly.push({ hour: h, avg: 0, max: 0, count: 0 });
        } else {
            const counts = hourEvents.map(e => e.peopleCount);
            hourly.push({
                hour: h,
                avg: Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 10) / 10,
                max: Math.max(...counts),
                count: hourEvents.length,
            });
        }
    }

    return hourly;
}

/**
 * Aforo por intervalo (5/15/30/45/60 min) de un día, en hora de Montevideo.
 * Filtra a canales de aforo/ocupación (no a los contadores Entrada/Salida).
 * - max: aforo más alto del intervalo
 * - avg: aforo promedio
 * - last: aforo exacto = última lectura del intervalo
 */
export async function getQueueIntervalBreakdown(deviceId?: string, date?: Date, intervalMin: number = 60) {
    const iv = [5, 15, 30, 45, 60].includes(intervalMin) ? intervalMin : 60;
    const targetDate = date || new Date();
    const { start, end } = uyDayWindow(targetDate);
    const where: any = { timestamp: { gte: start, lte: end } };
    if (deviceId) where.deviceId = deviceId;
    const all = await prisma.queueEvent.findMany({
        where,
        select: { timestamp: true, peopleCount: true, channelName: true },
        orderBy: { timestamp: "asc" },
    });
    const occRe = /aforo|occupancy|ocupaci|personas/i;
    let evs = all.filter(e => occRe.test(e.channelName || ""));
    if (!evs.length) evs = all.filter(e => !/entrada|salida/i.test(e.channelName || ""));

    const nBuckets = Math.ceil(1440 / iv);
    const buckets = Array.from({ length: nBuckets }, (_, b) => ({ startMin: b * iv, vals: [] as number[], last: 0 }));
    for (const e of evs) {
        const mod = uyMinuteOfDay(e.timestamp);
        const b = Math.min(Math.floor(mod / iv), nBuckets - 1);
        buckets[b].vals.push(e.peopleCount);
        buckets[b].last = e.peopleCount; // orden asc -> queda la última lectura
    }
    const pad = (n: number) => String(n).padStart(2, "0");
    return buckets.map(b => {
        const sh = Math.floor(b.startMin / 60), sm = b.startMin % 60;
        const eMin = b.startMin + iv, eh = Math.floor(eMin / 60) % 24, em = eMin % 60;
        const counts = b.vals;
        return {
            startMin: b.startMin,
            label: `${pad(sh)}:${pad(sm)}`,
            rangeLabel: `${pad(sh)}:${pad(sm)} - ${pad(eh)}:${pad(em)}`,
            avg: counts.length ? Math.round((counts.reduce((a, c) => a + c, 0) / counts.length) * 10) / 10 : 0,
            max: counts.length ? Math.max(...counts) : 0,
            min: counts.length ? Math.min(...counts) : 0,
            last: counts.length ? b.last : 0,
            count: counts.length,
        };
    });
}

// --- CRUD for QueueAlerts ---
export async function getQueueAlerts() {
    return prisma.queueAlert.findMany({
        include: { device: { select: { id: true, name: true, ip: true } } },
        orderBy: { createdAt: "desc" },
    });
}

export async function createQueueAlert(data: {
    name: string;
    deviceId?: string;
    channelName?: string;
    threshold: number;
    cooldownMin?: number;
    cooldownSec?: number;
}) {
    const sec = data.cooldownSec ?? (data.cooldownMin != null ? data.cooldownMin * 60 : 30);
    return prisma.queueAlert.create({
        data: {
            name: data.name,
            deviceId: data.deviceId || null,
            channelName: data.channelName || null,
            threshold: data.threshold,
            cooldownMin: Math.max(1, Math.round(sec / 60)),
            cooldownSec: sec,
        },
    });
}

export async function updateQueueAlert(id: string, data: {
    name?: string;
    deviceId?: string | null;
    channelName?: string | null;
    threshold?: number;
    enabled?: boolean;
    cooldownMin?: number;
    cooldownSec?: number;
}) {
    const upd: any = { ...data };
    if (data.cooldownSec != null) {
        upd.cooldownSec = data.cooldownSec;
        upd.cooldownMin = Math.max(1, Math.round(data.cooldownSec / 60));
    }
    return prisma.queueAlert.update({ where: { id }, data: upd });
}

export async function deleteQueueAlert(id: string) {
    return prisma.queueAlert.delete({ where: { id } });
}

// --- Get daily breakdown (for a date range) ---
export async function getQueueDailyBreakdown(deviceId?: string, from?: Date, to?: Date) {
    const end = to || new Date();
    const start = from || (() => { const d = new Date(end); d.setDate(d.getDate() - 30); return d; })();
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const where: any = { timestamp: { gte: start, lte: end } };
    if (deviceId) where.deviceId = deviceId;

    const events = await prisma.queueEvent.findMany({
        where,
        select: { timestamp: true, peopleCount: true, channelName: true },
        orderBy: { timestamp: "asc" },
    });

    const occRe = /aforo|occupancy|ocupaci|personas/i;
    let occEvs = events.filter((e: any) => occRe.test(e.channelName || ""));
    if (!occEvs.length) occEvs = events.filter((e: any) => !/entrada|salida/i.test(e.channelName || ""));

    const dayMap = new Map<string, number[]>();
    const lastMap = new Map<string, number>();
    for (const e of occEvs) {
        const d = new Date(e.timestamp);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const arr = dayMap.get(key) || [];
        arr.push(e.peopleCount);
        dayMap.set(key, arr);
        lastMap.set(key, e.peopleCount);
    }

    const result: { date: string; avg: number; max: number; count: number; total: number }[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
        const counts = dayMap.get(key) || [];
        result.push({
            date: key,
            avg: counts.length > 0 ? Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 10) / 10 : 0,
            max: counts.length > 0 ? Math.max(...counts) : 0,
            last: lastMap.get(key) ?? 0,
            count: counts.length,
            total: counts.reduce((a, b) => a + b, 0),
        });
        cursor.setDate(cursor.getDate() + 1);
    }
    return result;
}

// --- Get weekly breakdown ---
export async function getQueueWeeklyBreakdown(deviceId?: string, from?: Date, to?: Date) {
    const end = to || new Date();
    const start = from || (() => { const d = new Date(end); d.setDate(d.getDate() - 12 * 7); return d; })();
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const where: any = { timestamp: { gte: start, lte: end } };
    if (deviceId) where.deviceId = deviceId;

    const events = await prisma.queueEvent.findMany({
        where,
        select: { timestamp: true, peopleCount: true, channelName: true },
        orderBy: { timestamp: "asc" },
    });

    const occRe = /aforo|occupancy|ocupaci|personas/i;
    let occEvs = events.filter((e: any) => occRe.test(e.channelName || ""));
    if (!occEvs.length) occEvs = events.filter((e: any) => !/entrada|salida/i.test(e.channelName || ""));

    const weekMap = new Map<string, number[]>();
    const lastMap = new Map<string, number>();
    for (const e of occEvs) {
        const d = new Date(e.timestamp);
        const jan1 = new Date(d.getFullYear(), 0, 1);
        const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
        const key = `${d.getFullYear()}-S${String(week).padStart(2, "0")}`;
        const arr = weekMap.get(key) || [];
        arr.push(e.peopleCount);
        weekMap.set(key, arr);
        lastMap.set(key, e.peopleCount);
    }

    return Array.from(weekMap.entries()).map(([week, counts]) => ({
        week,
        avg: Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 10) / 10,
        max: Math.max(...counts),
        last: lastMap.get(week) ?? 0,
        count: counts.length,
        total: counts.reduce((a, b) => a + b, 0),
    })).sort((a, b) => a.week.localeCompare(b.week));
}

// --- Get monthly breakdown ---
export async function getQueueMonthlyBreakdown(deviceId?: string, from?: Date, to?: Date) {
    const end = to || new Date();
    const start = from || (() => { const d = new Date(end); d.setMonth(d.getMonth() - 12); return d; })();
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const where: any = { timestamp: { gte: start, lte: end } };
    if (deviceId) where.deviceId = deviceId;

    const events = await prisma.queueEvent.findMany({
        where,
        select: { timestamp: true, peopleCount: true, channelName: true },
        orderBy: { timestamp: "asc" },
    });

    const occRe = /aforo|occupancy|ocupaci|personas/i;
    let occEvs = events.filter((e: any) => occRe.test(e.channelName || ""));
    if (!occEvs.length) occEvs = events.filter((e: any) => !/entrada|salida/i.test(e.channelName || ""));

    const monthMap = new Map<string, number[]>();
    const lastMap = new Map<string, number>();
    for (const e of occEvs) {
        const d = new Date(e.timestamp);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const arr = monthMap.get(key) || [];
        arr.push(e.peopleCount);
        monthMap.set(key, arr);
        lastMap.set(key, e.peopleCount);
    }

    return Array.from(monthMap.entries()).map(([month, counts]) => ({
        month,
        avg: Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 10) / 10,
        max: Math.max(...counts),
        last: lastMap.get(month) ?? 0,
        count: counts.length,
        total: counts.reduce((a, b) => a + b, 0),
    })).sort((a, b) => a.month.localeCompare(b.month));
}

// --- Get queue devices for selects ---
export async function getQueueDevices() {
    return prisma.device.findMany({
        where: { deviceType: "QUEUE_COUNTER" },
        select: { id: true, name: true, ip: true, location: true, brand: true },
        orderBy: { name: "asc" },
    });
}


// --- Get queue notifications (events that crossed an enabled alert threshold) ---
export async function getQueueNotifications(options?: { take?: number }) {
    const alerts = await prisma.queueAlert.findMany({
        where: { enabled: true },
        include: { device: { select: { id: true, name: true, ip: true, location: true, brand: true } } },
    });
    if (alerts.length === 0) return [];

    const dispatchSettings = await prisma.setting.findMany({
        where: { key: { in: ["DISPATCH_TELEGRAM_ENABLED", "DISPATCH_EMAIL_ENABLED", "DISPATCH_WEBHOOK_ENABLED"] } },
    });
    const legacyChannels = await prisma.notificationChannel.count({ where: { enabled: true } }).catch(() => 0);
    const dispatchOn = legacyChannels > 0 || dispatchSettings.some(s => s.value === "true");

    const all: any[] = [];
    for (const alert of alerts) {
        const where: any = { peopleCount: { gte: alert.threshold } };
        if (alert.deviceId) where.deviceId = alert.deviceId;
        if (alert.channelName) where.channelName = alert.channelName;

        const events = await prisma.queueEvent.findMany({
            where, orderBy: { timestamp: "asc" }, take: 3000,
            include: { device: { select: { id: true, name: true, ip: true, location: true, brand: true } } },
        });

        // Collapse consecutive over-threshold readings into ONE notification per "episode"
        // (separated by more than the cooldown), keeping the peak + its snapshot.
        const cdSec = (alert as any).cooldownSec ?? (alert.cooldownMin || 1) * 60;
        const cdMs = Math.max(cdSec, 1) * 1000;
        let cur: any = null;
        const flush = () => { if (cur) { delete cur._lastT; cur.dispatch = dispatchOn ? "SENT" : "NONE"; all.push(cur); } };
        for (const e of events) {
            const t = new Date(e.timestamp).getTime();
            if (!cur || t - cur._lastT > cdMs) {
                flush();
                cur = {
                    id: e.id, alertId: alert.id, alertName: alert.name, threshold: alert.threshold,
                    cooldownMin: alert.cooldownMin, channelName: e.channelName, peopleCount: e.peopleCount,
                    timestamp: e.timestamp, snapshotPath: e.snapshotPath, device: e.device, _lastT: t,
                };
            } else {
                if (e.peopleCount > cur.peopleCount) {
                    cur.peopleCount = e.peopleCount; cur.id = e.id; cur.timestamp = e.timestamp;
                    if (e.snapshotPath) cur.snapshotPath = e.snapshotPath;
                }
                cur._lastT = t;
            }
        }
        flush();
    }

    const seen = new Set<string>();
    return all
        .filter(n => { if (seen.has(n.id)) return false; seen.add(n.id); return true; })
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, options?.take ?? 100);
}

// --- Camera outages (connectivity cuts) ---
export async function getCameraOutages(options?: {
    deviceId?: string;
    from?: Date;
    to?: Date;
    take?: number;
    includeOpen?: boolean;
}) {
    const where: any = {};
    if (options?.deviceId) where.deviceId = options.deviceId;
    if (options?.from || options?.to) {
        where.startedAt = {};
        if (options.from) where.startedAt.gte = options.from;
        if (options.to) where.startedAt.lte = options.to;
    }
    const outages = await prisma.cameraOutage.findMany({
        where,
        orderBy: { startedAt: "desc" },
        take: options?.take ?? 200,
    });
    return outages.map((o) => ({
        id: o.id,
        deviceId: o.deviceId,
        startedAt: o.startedAt,
        endedAt: o.endedAt,
        durationSec: o.durationSec ?? (o.endedAt
            ? Math.round((new Date(o.endedAt).getTime() - new Date(o.startedAt).getTime()) / 1000)
            : Math.round((Date.now() - new Date(o.startedAt).getTime()) / 1000)),
        lastValue: o.lastValue ?? null,
        ongoing: !o.endedAt,
    }));
}

// --- Flow (entries/exits per hour) ---
export async function getQueueFlowHourly(deviceId?: string, date?: Date) {
    const day = date ? new Date(date) : new Date();
    const { start, end } = uyDayWindow(day);
    const where: any = { timestamp: { gte: start, lte: end }, channelName: { in: ["Entrada", "Salida"] } };
    if (deviceId) where.deviceId = deviceId;
    const events = await prisma.queueEvent.findMany({
        where, select: { channelName: true, timestamp: true },
    });
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, entradas: 0, salidas: 0 }));
    for (const e of events) {
        const h = uyHour(e.timestamp);
        if (e.channelName === "Entrada") hours[h].entradas++;
        else if (e.channelName === "Salida") hours[h].salidas++;
    }
    const totalIn = hours.reduce((s, x) => s + x.entradas, 0);
    const totalOut = hours.reduce((s, x) => s + x.salidas, 0);
    return { hours, totalIn, totalOut, net: totalIn - totalOut };
}

// --- Estimated wait time (Little's law-ish: occupancy / service rate) ---
export async function getQueueWaitEstimate(deviceId?: string) {
    const aforoWhere: any = { channelName: "Aforo" };
    if (deviceId) aforoWhere.deviceId = deviceId;
    const latest = await prisma.queueEvent.findFirst({ where: aforoWhere, orderBy: { timestamp: "desc" } });
    const aforo = latest?.peopleCount ?? 0;

    const windowMin = 15;
    const since = new Date(Date.now() - windowMin * 60 * 1000);
    const exitWhere: any = { channelName: "Salida", timestamp: { gte: since } };
    if (deviceId) exitWhere.deviceId = deviceId;
    const exits = await prisma.queueEvent.count({ where: exitWhere });

    const exitRatePerMin = exits / windowMin;               // personas/min que salen
    const servicePerPersonMin = exitRatePerMin > 0 ? 1 / exitRatePerMin : null;
    const waitMin = servicePerPersonMin != null ? Math.round(aforo * servicePerPersonMin) : null;

    return {
        aforo,
        exits15: exits,
        exitRatePerMin: Math.round(exitRatePerMin * 100) / 100,
        servicePerPersonMin: servicePerPersonMin != null ? Math.round(servicePerPersonMin * 10) / 10 : null,
        waitMin,
    };
}

// --- Calibration helper: raw vs stabilized aforo + suggested debounce ---
export async function getQueueRawVsStable(deviceId?: string, minutes: number = 10) {
    const since = new Date(Date.now() - minutes * 60 * 1000);
    const where: any = { channelName: "Aforo", timestamp: { gte: since } };
    if (deviceId) where.deviceId = deviceId;
    const rows = await prisma.queueEvent.findMany({
        where, orderBy: { timestamp: "asc" }, select: { peopleCount: true, timestamp: true },
    });
    const raw = rows.map(r => ({ t: new Date(r.timestamp).getTime(), v: r.peopleCount }));

    // Stabilized: adopt a new value only if it persists >= HOLD ms
    const HOLD = 2000;
    const stable: { t: number; v: number }[] = [];
    let current = raw.length ? raw[0].v : 0;
    let candidate = current, candidateSince = raw.length ? raw[0].t : 0;
    for (const p of raw) {
        if (p.v === current) { candidate = current; }
        else {
            if (p.v !== candidate) { candidate = p.v; candidateSince = p.t; }
            else if (p.t - candidateSince >= HOLD) { current = candidate; }
        }
        stable.push({ t: p.t, v: current });
    }

    const rawChanges = raw.filter((p, i) => i > 0 && p.v !== raw[i - 1].v).length;
    const stableChanges = stable.filter((p, i) => i > 0 && p.v !== stable[i - 1].v).length;
    const changesPerMin = minutes > 0 ? Math.round((rawChanges / minutes) * 10) / 10 : 0;
    const vals = raw.map(p => p.v);
    const amplitude = vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
    let suggestedReboteSec = 1;
    if (changesPerMin > 30) suggestedReboteSec = 3;
    else if (changesPerMin > 15) suggestedReboteSec = 2.5;
    else if (changesPerMin > 8) suggestedReboteSec = 2;
    else if (changesPerMin > 4) suggestedReboteSec = 1.5;

    return { raw, stable, rawChanges, stableChanges, changesPerMin, amplitude, suggestedReboteSec, samples: raw.length, minutes };
}

// ─────────────────────────────────────────────────────────────────────────
// Notificaciones: reglas de notificación (criterios/filtros)
// ─────────────────────────────────────────────────────────────────────────
export async function getNotificationRules() {
    return prisma.notificationRule.findMany({ orderBy: [{ enabled: "desc" }, { createdAt: "desc" }] });
}

type RuleInput = {
    name: string;
    enabled?: boolean;
    deviceId?: string | null;
    channelName?: string | null;
    metric?: string;        // aforo | entrada | salida
    operator?: string;      // >= | > | == | <=
    threshold?: number;
    daysOfWeek?: string;    // "1,2,3,4,5,6,7"
    startTime?: string;     // "08:00"
    endTime?: string;       // "20:00"
    channels?: string;      // "telegram,email"
    minSeverity?: string | null;
    cooldownSec?: number;
    dedupe?: boolean;
};

export async function createNotificationRule(data: RuleInput) {
    return prisma.notificationRule.create({
        data: {
            name: data.name,
            enabled: data.enabled ?? true,
            deviceId: data.deviceId || null,
            channelName: data.channelName || null,
            metric: data.metric || "aforo",
            operator: data.operator || ">=",
            threshold: data.threshold ?? 1,
            daysOfWeek: data.daysOfWeek || "1,2,3,4,5,6,7",
            startTime: data.startTime || "00:00",
            endTime: data.endTime || "23:59",
            channels: data.channels || "telegram",
            minSeverity: data.minSeverity || null,
            cooldownSec: data.cooldownSec ?? 60,
            dedupe: data.dedupe ?? true,
        },
    });
}

export async function updateNotificationRule(id: string, data: Partial<RuleInput>) {
    return prisma.notificationRule.update({
        where: { id },
        data: {
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
            ...(data.deviceId !== undefined ? { deviceId: data.deviceId || null } : {}),
            ...(data.channelName !== undefined ? { channelName: data.channelName || null } : {}),
            ...(data.metric !== undefined ? { metric: data.metric } : {}),
            ...(data.operator !== undefined ? { operator: data.operator } : {}),
            ...(data.threshold !== undefined ? { threshold: data.threshold } : {}),
            ...(data.daysOfWeek !== undefined ? { daysOfWeek: data.daysOfWeek } : {}),
            ...(data.startTime !== undefined ? { startTime: data.startTime } : {}),
            ...(data.endTime !== undefined ? { endTime: data.endTime } : {}),
            ...(data.channels !== undefined ? { channels: data.channels } : {}),
            ...(data.minSeverity !== undefined ? { minSeverity: data.minSeverity || null } : {}),
            ...(data.cooldownSec !== undefined ? { cooldownSec: data.cooldownSec } : {}),
            ...(data.dedupe !== undefined ? { dedupe: data.dedupe } : {}),
        },
    });
}

export async function deleteNotificationRule(id: string) {
    await prisma.notificationRule.delete({ where: { id } });
    return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Despachos: lectura de la cola/outbox (DispatchJob)
// ─────────────────────────────────────────────────────────────────────────
export async function getDispatchJobs(opts?: { take?: number; status?: string }) {
    const where: any = {};
    if (opts?.status) where.status = opts.status;
    return prisma.dispatchJob.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: opts?.take ?? 100,
    });
}

export async function getDispatchStats() {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const [pending, sent, failed] = await Promise.all([
        prisma.dispatchJob.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
        prisma.dispatchJob.count({ where: { status: "SENT", sentAt: { gte: since } } }),
        prisma.dispatchJob.count({ where: { status: "FAILED" } }),
    ]);
    return { pending, sent, failed };
}

// Re-encolar un despacho (p.ej. uno fallido) creando un nuevo DispatchJob.
export async function retryDispatchJob(id: string) {
    const dj = await prisma.dispatchJob.findUnique({ where: { id } });
    if (!dj) return { ok: false };
    const { enqueueDispatch } = await import("@/lib/dispatch-queue");
    await enqueueDispatch({
        type: dj.type as "ALERT" | "REPORT",
        channel: dj.channel,
        payload: dj.payload,
        ruleId: dj.ruleId,
        deviceId: dj.deviceId,
        maxAttempts: dj.maxAttempts,
    });
    return { ok: true };
}

// Encolar un reporte para despacho manual (botón "Despachar").
export async function enqueueReportDispatch(input: { period: "daily" | "weekly"; deviceId?: string | null; channel?: string }) {
    const { enqueueDispatch } = await import("@/lib/dispatch-queue");
    const job = await enqueueDispatch({
        type: "REPORT",
        channel: input.channel || "telegram",
        payload: { period: input.period, deviceId: input.deviceId || null },
        deviceId: input.deviceId || null,
        maxAttempts: 3,
    });
    return { ok: true, id: job.id };
}

// ─────────────────────────────────────────────────────────────────────────
// Reportes programados (ReportSchedule)
// ─────────────────────────────────────────────────────────────────────────
export async function getReportSchedules() {
    return prisma.reportSchedule.findMany({ orderBy: [{ enabled: "desc" }, { createdAt: "desc" }] });
}
type SchedInput = {
    name: string; enabled?: boolean; frequency?: string; time?: string;
    dayOfWeek?: number; period?: string; deviceId?: string | null; channel?: string;
};
export async function createReportSchedule(data: SchedInput) {
    const freq = data.frequency || "daily";
    return prisma.reportSchedule.create({
        data: {
            name: data.name, enabled: data.enabled ?? true,
            frequency: freq, time: data.time || "22:00",
            dayOfWeek: data.dayOfWeek ?? 7, period: data.period || freq,
            deviceId: data.deviceId || null, channel: data.channel || "telegram",
        },
    });
}
export async function updateReportSchedule(id: string, data: Partial<SchedInput>) {
    const patch: any = {};
    for (const k of ["name", "enabled", "frequency", "time", "dayOfWeek", "channel"] as const)
        if ((data as any)[k] !== undefined) patch[k] = (data as any)[k];
    if (data.deviceId !== undefined) patch.deviceId = data.deviceId || null;
    if (data.frequency !== undefined) patch.period = data.frequency; // window follows cadence
    return prisma.reportSchedule.update({ where: { id }, data: patch });
}
export async function deleteReportSchedule(id: string) {
    await prisma.reportSchedule.delete({ where: { id } });
    return { ok: true };
}

// ── Series con rango (24h horas / 7d-30d por día) para flujo-filas ──────────
function _rangeWindow(range: string) {
    const now = new Date();
    if (range === "7d") { const s = new Date(now); s.setDate(s.getDate() - 6); s.setHours(0, 0, 0, 0); return { start: s, end: now, days: 7 }; }
    if (range === "30d") { const s = new Date(now); s.setDate(s.getDate() - 29); s.setHours(0, 0, 0, 0); return { start: s, end: now, days: 30 }; }
    const s = new Date(now); s.setHours(0, 0, 0, 0); return { start: s, end: now, days: 0 };
}
function _dLabel(d: Date) { return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; }

export async function getQueueAforoSeries(deviceId?: string, range: string = "24h") {
    if (range === "24h") {
        const hourly = await getQueueHourlyBreakdown(deviceId);
        return { buckets: hourly.map(h => ({ label: String(h.hour).padStart(2, "0") + "h", avg: h.avg, max: h.max, count: h.count })), unit: "hour" };
    }
    const { start, end, days } = _rangeWindow(range);
    const where: any = { timestamp: { gte: start, lte: end } };
    if (deviceId) where.deviceId = deviceId;
    const events = await prisma.queueEvent.findMany({ where, select: { timestamp: true, peopleCount: true } });
    const buckets: any[] = [];
    for (let d = 0; d < days; d++) {
        const day = new Date(start); day.setDate(start.getDate() + d);
        const next = new Date(day); next.setDate(day.getDate() + 1);
        const evs = events.filter(e => { const t = new Date(e.timestamp); return t >= day && t < next; });
        const counts = evs.map(e => e.peopleCount);
        buckets.push({ label: _dLabel(day), avg: counts.length ? Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 10) / 10 : 0, max: counts.length ? Math.max(...counts) : 0, count: evs.length });
    }
    return { buckets, unit: "day" };
}

export async function getQueueFlowSeries(deviceId?: string, range: string = "24h") {
    if (range === "24h") {
        const f = await getQueueFlowHourly(deviceId);
        return { buckets: f.hours.map(h => ({ label: String(h.hour).padStart(2, "0") + "h", entradas: h.entradas, salidas: h.salidas })), totalIn: f.totalIn, totalOut: f.totalOut, net: f.net, unit: "hour" };
    }
    const { start, end, days } = _rangeWindow(range);
    const where: any = { timestamp: { gte: start, lte: end }, channelName: { in: ["Entrada", "Salida"] } };
    if (deviceId) where.deviceId = deviceId;
    const events = await prisma.queueEvent.findMany({ where, select: { channelName: true, timestamp: true } });
    const buckets: any[] = [];
    for (let d = 0; d < days; d++) {
        const day = new Date(start); day.setDate(start.getDate() + d);
        const next = new Date(day); next.setDate(day.getDate() + 1);
        let entradas = 0, salidas = 0;
        for (const e of events) { const t = new Date(e.timestamp); if (t >= day && t < next) { if (e.channelName === "Entrada") entradas++; else salidas++; } }
        buckets.push({ label: _dLabel(day), entradas, salidas });
    }
    const totalIn = buckets.reduce((s, b) => s + b.entradas, 0);
    const totalOut = buckets.reduce((s, b) => s + b.salidas, 0);
    return { buckets, totalIn, totalOut, net: totalIn - totalOut, unit: "day" };
}

// --- Dispatch message templates (stored as JSON in Setting DISPATCH_TEMPLATES) ---
export async function getDispatchTemplates() {
    const s = await prisma.setting.findUnique({ where: { key: "DISPATCH_TEMPLATES" } });
    if (!s?.value) return [];
    try { return JSON.parse(s.value); } catch { return []; }
}

export async function saveDispatchTemplates(tpls: { id: string; name: string; channel: string; body: string }[]) {
    const value = JSON.stringify(Array.isArray(tpls) ? tpls : []);
    await prisma.setting.upsert({
        where: { key: "DISPATCH_TEMPLATES" },
        update: { value },
        create: { key: "DISPATCH_TEMPLATES", value },
    });
    return { success: true };
}

// --- Dispatch volume series (last 24h, hourly) for the queue chart ---
export async function getDispatchSeries() {
    const now = new Date();
    const start = new Date(now.getTime() - 24 * 3600 * 1000);
    const jobs = await prisma.dispatchJob.findMany({
        where: { createdAt: { gte: start } },
        select: { createdAt: true, status: true },
    });
    const buckets = Array.from({ length: 24 }, (_, i) => ({ i, label: "", count: 0, sent: 0, failed: 0 }));
    for (const j of jobs) {
        const idx = Math.min(23, Math.max(0, Math.floor((j.createdAt.getTime() - start.getTime()) / 3600000)));
        buckets[idx].count++;
        if (j.status === "SENT") buckets[idx].sent++;
        else if (j.status === "FAILED") buckets[idx].failed++;
    }
    buckets.forEach((b, i) => { b.label = String(new Date(start.getTime() + i * 3600000).getHours()).padStart(2, "0") + "h"; });
    return buckets;
}

// --- Notification recipients (DISPATCH_RECIPIENTS JSON in Setting) ---
export async function getDispatchRecipients() {
    const s = await prisma.setting.findUnique({ where: { key: "DISPATCH_RECIPIENTS" } });
    if (!s?.value) return [];
    try { return JSON.parse(s.value); } catch { return []; }
}

export async function saveDispatchRecipients(list: { id: string; name: string; channel: string; address: string; enabled: boolean }[]) {
    const value = JSON.stringify(Array.isArray(list) ? list : []);
    await prisma.setting.upsert({
        where: { key: "DISPATCH_RECIPIENTS" },
        update: { value },
        create: { key: "DISPATCH_RECIPIENTS", value },
    });
    return { success: true };
}

// --- Dispatch history (recent DispatchJobs, enriched with recipient) ---
export async function getDispatchHistory(options?: { take?: number }) {
    const jobs = await prisma.dispatchJob.findMany({ orderBy: { createdAt: "desc" }, take: options?.take ?? 60 });
    return jobs.map((j) => {
        const p: any = (j as any).payload || {};
        return {
            id: j.id, type: j.type, channel: j.channel, status: j.status,
            attempts: j.attempts, maxAttempts: j.maxAttempts, lastError: j.lastError,
            recipient: p.recipientName || p.chatId || p.to || p.email || null,
            recipientChannel: p.recipientChannel || j.channel,
            ruleName: p.ruleName || (j.type === "REPORT" ? "Reporte" : "Alerta"),
            deviceName: p.deviceName || null, count: p.count ?? null, threshold: p.threshold ?? null,
            channelName: p.channelName || null, snapshotPath: p.snapshotPath || null,
            message: p.sentText || p.text || (j.type === "REPORT" ? `Reporte ${p.period || "diario"}${p.deviceName ? " - " + p.deviceName : ""}` : (p.ruleName ? `${p.ruleName}${p.count != null ? ` - aforo ${p.count}/${p.threshold ?? "?"}` : ""}` : null)),
            createdAt: j.createdAt, sentAt: j.sentAt,
        };
    });
}


// --- WhatsApp groups seen via inbound webhook (for recipient picker) ---
export async function getWhatsAppSeenGroups() {
    const s = await prisma.setting.findUnique({ where: { key: "WHATSAPP_SEEN_GROUPS" } });
    if (!s?.value) return [] as { id: string; name: string }[];
    try {
        const arr = JSON.parse(s.value);
        return Array.isArray(arr) ? arr.map((g: any) => ({ id: g.id, name: g.name || g.id })) : [];
    } catch { return []; }
}


// Estado en vivo del sistema: pre-grabación (ring buffer) + flujos procesados por cámara de fila.
export async function getSystemLiveStatus() {
    const fs = await import("fs");
    const path = await import("path");
    const RING_ROOT = "/opt/OmniAccess/public/clips/ring";
    const now = Date.now();
    const ACTIVE_WINDOW_MS = 6 * 60 * 60 * 1000;
    const devices = await prisma.device.findMany({ where: { deviceType: "QUEUE_COUNTER" }, select: { id: true, name: true, ip: true } });
    const out: any[] = [];
    for (const d of devices) {
        // pre-rec: mtime del segmento más nuevo del anillo
        let preRecMs = 0;
        try {
            const dir = path.join(RING_ROOT, d.id);
            for (const fn of fs.readdirSync(dir)) {
                if (!fn.endsWith(".ts")) continue;
                const m = fs.statSync(path.join(dir, fn)).mtimeMs;
                if (m > preRecMs) preRecMs = m;
            }
        } catch {}
        const preRecActive = preRecMs > 0 && (now - preRecMs) < 15000;
        // flujos en vivo: último evento por canal, sólo canales activos
        let channels: any[] = [];
        try {
            const ev: any[] = await prisma.$queryRawUnsafe(
                'SELECT DISTINCT ON ("channelName") "channelName","peopleCount","timestamp" FROM "QueueEvent" WHERE "deviceId"=$1 ORDER BY "channelName","timestamp" DESC',
                d.id
            );
            const latest = ev.reduce((mx, e) => Math.max(mx, new Date(e.timestamp).getTime()), 0);
            channels = ev
                .filter(e => latest - new Date(e.timestamp).getTime() <= ACTIVE_WINDOW_MS)
                .map(e => ({ name: e.channelName, count: Number(e.peopleCount), ageSec: Math.round((now - new Date(e.timestamp).getTime()) / 1000) }))
                .sort((a, b) => (/(aforo|occupancy|ocupaci|personas)/i.test(a.name) ? -1 : 1) - (/(aforo|occupancy|ocupaci|personas)/i.test(b.name) ? -1 : 1));
        } catch {}
        out.push({ deviceId: d.id, name: d.name, ip: d.ip, preRecActive, preRecAgeSec: preRecMs ? Math.round((now - preRecMs) / 1000) : null, channels });
    }
    return out;
}


// ── Pre-grabación: gestión de grabadores ffmpeg (ring buffer) + almacenamiento ──
export async function getPreRecStatus() {
    const cp = await import("child_process");
    const fs = await import("fs");
    const path = await import("path");
    const RING_ROOT = "/opt/OmniAccess/public/clips/ring";

    // Procesos ffmpeg que están grabando el anillo
    const procByDevice: Record<string, { pid: number; uptimeSec: number }> = {};
    let instances = 0;
    try {
        const out = cp.execSync("ps -eo pid,etimes,args 2>/dev/null", { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
        for (const line of out.split("\n")) {
            if (!line.includes("/clips/ring/") || !line.includes("ffmpeg")) continue;
            const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
            if (!m) continue;
            const dm = m[3].match(/\/clips\/ring\/([^/\\]+)/);
            if (!dm) continue;
            instances++;
            procByDevice[dm[1]] = { pid: Number(m[1]), uptimeSec: Number(m[2]) };
        }
    } catch {}

    // Disco de la partición de clips
    let disk = { totalBytes: 0, usedBytes: 0, freeBytes: 0 };
    try {
        const d = cp.execSync("df -B1 --output=size,used,avail /opt/OmniAccess/public/clips 2>/dev/null | tail -1", { encoding: "utf8" });
        const p = d.trim().split(/\s+/).map((x) => Number(x));
        if (p.length >= 3 && p[0] > 0) disk = { totalBytes: p[0], usedBytes: p[1], freeBytes: p[2] };
    } catch {}

    const devices = await prisma.device.findMany({ where: { deviceType: "QUEUE_COUNTER" }, select: { id: true, name: true, ip: true } });
    let ringTotal = 0;
    const now = Date.now();
    const out: any[] = [];
    for (const dv of devices) {
        const dir = path.join(RING_ROOT, dv.id);
        let bytes = 0, segs = 0, newestMs = 0;
        try {
            for (const fn of fs.readdirSync(dir)) {
                if (!fn.endsWith(".ts")) continue;
                const st = fs.statSync(path.join(dir, fn));
                bytes += st.size; segs++; if (st.mtimeMs > newestMs) newestMs = st.mtimeMs;
            }
        } catch {}
        ringTotal += bytes;
        const proc = procByDevice[dv.id] || null;
        out.push({
            deviceId: dv.id, name: dv.name, ip: dv.ip,
            running: !!proc, pid: proc ? proc.pid : null, uptimeSec: proc ? proc.uptimeSec : null,
            fresh: newestMs > 0 && (now - newestMs) < 15000,
            ringBytes: bytes, segments: segs,
        });
    }
    return { instances, ringTotalBytes: ringTotal, disk, devices: out };
}

// Corta (kill) un grabador ffmpeg colgado; el worker lo re-levanta solo en <=30s.
export async function killPreRecFlow(pid: number) {
    const cp = await import("child_process");
    const p = Number(pid);
    if (!p || p < 2) return { ok: false, error: "PID inválido" };
    try {
        const args = cp.execSync(`ps -p ${p} -o args= 2>/dev/null`, { encoding: "utf8" });
        if (!args.includes("/clips/ring/") || !args.includes("ffmpeg")) return { ok: false, error: "Ese proceso no es un grabador de pre-grabación" };
        cp.execSync(`kill ${p} 2>/dev/null`);
        return { ok: true };
    } catch (e: any) { return { ok: false, error: (e && e.message) || "No se pudo cortar el flujo" }; }
}


// Borra carpetas de ring buffer que no corresponden a una cámara de fila activa.
export async function cleanOrphanRings() {
    const fs = await import("fs");
    const path = await import("path");
    const RING_ROOT = "/opt/OmniAccess/public/clips/ring";
    const devices = await prisma.device.findMany({ where: { deviceType: "QUEUE_COUNTER" }, select: { id: true } });
    const active = new Set(devices.map((d) => d.id));
    let removed = 0, bytes = 0;
    try {
        for (const name of fs.readdirSync(RING_ROOT)) {
            if (active.has(name)) continue;
            const dir = path.join(RING_ROOT, name);
            try {
                const st = fs.statSync(dir);
                if (!st.isDirectory()) continue;
                for (const fn of fs.readdirSync(dir)) { try { bytes += fs.statSync(path.join(dir, fn)).size; } catch {} }
                fs.rmSync(dir, { recursive: true, force: true });
                removed++;
            } catch {}
        }
    } catch {}
    return { removed, bytes };
}
