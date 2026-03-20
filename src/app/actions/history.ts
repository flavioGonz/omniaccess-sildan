"use server";

import { prisma } from "@/lib/prisma";
import { unstable_noStore as noStore } from 'next/cache';

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
    noStore();
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

        // N+1 Query removed for performance. 
        // Enrichment should be done in a single batch query or omitted if not needed (e.g. Dashboard)
        if (options?.omitEnrichment) {
            return { events, total };
        }

        return { events, total };

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
