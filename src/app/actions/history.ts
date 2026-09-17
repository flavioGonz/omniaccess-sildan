"use server";

import { prisma } from "@/lib/prisma";

export async function getAccessEvents(options?: {
    take?: number,
    skip?: number,
    search?: string,
    decision?: "GRANT" | "DENY" | "ALL",
    type?: "PLATE" | "FACE" | "TAG" | "ALL",
    direction?: "ENTRY" | "EXIT" | "ALL",
    unit?: string,
    userId?: string,
    name?: string,
    from?: Date,
    to?: Date,
    omitEnrichment?: boolean
}) {
    const whereClause: any = {};

    if (options?.userId) {
        whereClause.userId = options.userId;
    }

    if (options?.name) {
        whereClause.OR = [
            { user: { name: { contains: options.name, mode: 'insensitive' } } },
            { bitacora: { name: { contains: options.name, mode: 'insensitive' } } }
        ];
    }

    if (options?.decision && options.decision !== "ALL") {
        whereClause.decision = options.decision;
    }

    if (options?.type && options.type !== "ALL") {
        whereClause.accessType = options.type;
    }

    if (options?.direction && options.direction !== "ALL") {
        whereClause.direction = options.direction;
    }

    if (options?.unit) {
        whereClause.user = {
            unit: {
                name: { contains: options.unit, mode: 'insensitive' }
            }
        };
    }

    if (options?.search) {
        const search = options.search.toLowerCase();
        // search logic (plate OR user name OR device name OR unit name OR details for FaceID)
        whereClause.OR = [
            { plateDetected: { contains: search, mode: 'insensitive' } },
            { user: { name: { contains: search, mode: 'insensitive' } } },
            { user: { unit: { name: { contains: search, mode: 'insensitive' } } } },
            { device: { name: { contains: search, mode: 'insensitive' } } },
            { details: { contains: search, mode: 'insensitive' } }
        ];
    }

    if (options?.from || options?.to) {
        whereClause.timestamp = {};
        if (options.from) whereClause.timestamp.gte = options.from;
        if (options.to) whereClause.timestamp.lte = options.to;
    }

    try {
        const [events, total] = await Promise.all([
            prisma.accessEvent.findMany({
                where: whereClause,
                take: options?.take ?? 50,
                skip: options?.skip ?? 0,
                orderBy: { timestamp: "desc" },
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            role: true,
                            email: true,
                            phone: true,
                            dni: true,
                            apartment: true,
                            cara: true,
                            unit: {
                                select: { name: true }
                            },
                            parkingSlotId: true,
                            vehicles: true
                        }
                    },
                    device: true,
                    bitacora: true,
                },
            }),
            prisma.accessEvent.count({ where: whereClause })
        ]);

        if (options?.omitEnrichment) {
            return { events, total };
        }

        // Batch enrichment: single raw SQL query to get previous events for ALL events at once.
        // This replaces the N+1 pattern (1 query per event) with 1 query total.
        const enrichedEvents = await enrichEventsWithDuration(events);

        return { events: enrichedEvents, total };

    } catch (error) {
        console.error("Database connection error in getAccessEvents:", error);
        return { events: [], total: 0 };
    }
}

export async function getEventsCountToday(type?: "PLATE" | "FACE" | "TAG") {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const baseWhere: any = { timestamp: { gte: startOfDay } };
    if (type) baseWhere.accessType = type;

    try {
        const [total, grants, denies] = await Promise.all([
            prisma.accessEvent.count({
                where: baseWhere
            }),
            prisma.accessEvent.count({
                where: {
                    ...baseWhere,
                    decision: "GRANT"
                }
            }),
            prisma.accessEvent.count({
                where: {
                    ...baseWhere,
                    decision: "DENY"
                }
            })
        ]);
        return { total, grants, denies };
    } catch (error) {
        console.error("Database connection error in getEventsCountToday:", error);
        return { total: 0, grants: 0, denies: 0 };
    }
}

export async function getRelatedSessionEvents(eventId: string) {
    try {
        const event = await prisma.accessEvent.findUnique({
            where: { id: eventId },
            select: { timestamp: true, deviceId: true }
        });

        if (!event || !event.deviceId) return [];

        // Find events +/- 1 minute from the same device
        const windowMs = 60 * 1000;
        const startWindow = new Date(event.timestamp.getTime() - windowMs);
        const endWindow = new Date(event.timestamp.getTime() + windowMs);

        const related = await prisma.accessEvent.findMany({
            where: {
                deviceId: event.deviceId,
                timestamp: {
                    gte: startWindow,
                    lte: endWindow
                }
            },
            orderBy: { timestamp: 'asc' },
            include: {
                user: {
                    select: { name: true }
                }
            }
        });

        return related;
    } catch (error) {
        console.error("Database connection error in getRelatedSessionEvents:", error);
        return [];
    }
}

export async function getPlateAnalysis(plate: string) {
    try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const events = await prisma.accessEvent.findMany({
            where: {
                plateDetected: plate,
                timestamp: {
                    gte: sevenDaysAgo
                }
            },
            orderBy: {
                timestamp: 'desc'
            },
            select: {
                id: true,
                direction: true,
                timestamp: true,
                decision: true
            }
        });

        const totalEvents = events.length;
        const entries = events.filter(e => e.direction === 'ENTRY').length;
        const exits = events.filter(e => e.direction === 'EXIT').length;
        const grants = events.filter(e => e.decision === 'GRANT').length;
        const denies = events.filter(e => e.decision === 'DENY').length;
        const lastVisit = events[0]?.timestamp || null;

        return {
            totalEvents,
            entries,
            exits,
            grants,
            denies,
            lastVisit,
            events: events.slice(0, 5) // últimos 5 eventos
        };
    } catch (error) {
        console.error("Error in getPlateAnalysis:", error);
        return {
            totalEvents: 0,
            entries: 0,
            exits: 0,
            grants: 0,
            denies: 0,
            lastVisit: null,
            events: []
        };
    }
}

/**
 * Batch-compute stayDuration for a list of events using a single raw SQL query.
 * Replaces the N+1 pattern where each event triggered its own findFirst query.
 * Uses PostgreSQL LAG() window function to find the previous event per identity.
 */
async function enrichEventsWithDuration(events: any[]) {
    if (events.length === 0) return events;

    // Collect unique identifiers we need to look up
    const plateIds = new Set<string>();
    const userIds = new Set<string>();

    for (const event of events) {
        const plate = event.plateDetected?.trim();
        if (event.accessType === 'FACE' && event.userId) {
            userIds.add(event.userId);
        } else if (event.accessType === 'PLATE' && plate && plate !== 'unknown' && plate !== 'NO_LEIDA') {
            plateIds.add(plate.toUpperCase());
        }
    }

    // Build a map of eventId -> previous event info using raw SQL with LAG()
    const previousMap = new Map<string, { duration: number; previousDirection: string }>();

    try {
        // For PLATE events: get previous event per plate using window function
        if (plateIds.size > 0) {
            const plateDurations: any[] = await prisma.$queryRawUnsafe(`
                SELECT id, "plateDetected", timestamp, direction,
                    LAG(timestamp) OVER (PARTITION BY UPPER("plateDetected") ORDER BY timestamp) as prev_timestamp,
                    LAG(direction) OVER (PARTITION BY UPPER("plateDetected") ORDER BY timestamp) as prev_direction
                FROM "AccessEvent"
                WHERE UPPER("plateDetected") IN (${Array.from(plateIds).map(p => `'${p.replace(/'/g, "''")}'`).join(',')})
                  AND "accessType" = 'PLATE'
                ORDER BY timestamp DESC
            `);

            for (const row of plateDurations) {
                if (row.prev_timestamp) {
                    const duration = new Date(row.timestamp).getTime() - new Date(row.prev_timestamp).getTime();
                    previousMap.set(row.id, { duration, previousDirection: row.prev_direction });
                }
            }
        }

        // For FACE events: get previous event per userId using window function
        if (userIds.size > 0) {
            const faceDurations: any[] = await prisma.$queryRawUnsafe(`
                SELECT id, "userId", timestamp, direction,
                    LAG(timestamp) OVER (PARTITION BY "userId" ORDER BY timestamp) as prev_timestamp,
                    LAG(direction) OVER (PARTITION BY "userId" ORDER BY timestamp) as prev_direction
                FROM "AccessEvent"
                WHERE "userId" IN (${Array.from(userIds).map(u => `'${u.replace(/'/g, "''")}'`).join(',')})
                  AND "accessType" = 'FACE'
                ORDER BY timestamp DESC
            `);

            for (const row of faceDurations) {
                if (row.prev_timestamp) {
                    const duration = new Date(row.timestamp).getTime() - new Date(row.prev_timestamp).getTime();
                    previousMap.set(row.id, { duration, previousDirection: row.prev_direction });
                }
            }
        }
    } catch (error) {
        console.error("[History] Batch duration query failed, returning events without duration:", error);
        return events.map(e => ({ ...e, stayDuration: null, previousDirection: null }));
    }

    // Merge results
    return events.map(event => {
        const prev = previousMap.get(event.id);
        return {
            ...event,
            stayDuration: prev?.duration ?? null,
            previousDirection: prev?.previousDirection ?? null
        };
    });
}


export async function getAccessEvent(id: string) {
    try {
        return await prisma.accessEvent.findUnique({
            where: { id },
            include: {
                user: {
                    include: { unit: true }
                },
                device: true
            }
        });
    } catch (error) {
        console.error("Error in getAccessEvent:", error);
        return null;
    }
}


export async function getHourlyStats(type?: "PLATE" | "FACE" | "TAG") {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const now = new Date();

    const baseWhere: any = {
        timestamp: { gte: startOfDay, lte: now },
    };
    if (type) baseWhere.accessType = type;

    try {
        const events = await prisma.accessEvent.findMany({
            where: baseWhere,
            select: { timestamp: true, decision: true, direction: true },
            orderBy: { timestamp: "asc" },
        });

        // Build hourly buckets 0-23
        const hours: { hour: number; total: number; grants: number; denies: number; entries: number; exits: number }[] = [];
        for (let h = 0; h <= now.getHours(); h++) {
            hours.push({ hour: h, total: 0, grants: 0, denies: 0, entries: 0, exits: 0 });
        }

        for (const ev of events) {
            const h = new Date(ev.timestamp).getHours();
            const bucket = hours.find(b => b.hour === h);
            if (!bucket) continue;
            bucket.total++;
            if (ev.decision === "GRANT") bucket.grants++;
            else bucket.denies++;
            if (ev.direction === "ENTRY") bucket.entries++;
            else if (ev.direction === "EXIT") bucket.exits++;
        }

        return hours;
    } catch (error) {
        console.error("Error in getHourlyStats:", error);
        return [];
    }
}

export async function getLprCounters() {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const base: any = { timestamp: { gte: startOfDay }, accessType: "PLATE" };
    try {
        const [entradas, salidas] = await Promise.all([
            prisma.accessEvent.count({ where: { ...base, direction: "ENTRY", decision: "GRANT" } }),
            prisma.accessEvent.count({ where: { ...base, direction: "EXIT", decision: "GRANT" } }),
        ]);
        return { entradas, salidas, inside: Math.max(0, entradas - salidas) };
    } catch (e) { return { entradas: 0, salidas: 0, inside: 0 }; }
}

export async function getLastEventPerDevice() {
    try {
        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT DISTINCT ON ("deviceId") "deviceId", id, "plateDetected", "snapshotPath", "imagePath", decision, direction, timestamp, details
            FROM "AccessEvent"
            WHERE "accessType" = 'PLATE' AND "deviceId" IS NOT NULL AND "snapshotPath" IS NOT NULL AND "snapshotPath" <> ''
            ORDER BY "deviceId", timestamp DESC
        `);
        const map: Record<string, any> = {};
        for (const r of rows) map[r.deviceId] = r;
        return map;
    } catch (e) { return {}; }
}
