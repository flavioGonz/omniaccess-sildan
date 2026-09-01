"use server";

import { prisma } from "@/lib/prisma";
import { Vehicle } from "@prisma/client";
import { revalidatePath } from "next/cache";

export async function getVehicles(skip: number = 0, take: number = 20, query?: string) {
    try {
        const where = query ? {
            OR: [
                { plate: { contains: query.toUpperCase() } },
                { brand: { contains: query, mode: 'insensitive' as any } },
                { model: { contains: query, mode: 'insensitive' as any } },
                { user: { name: { contains: query, mode: 'insensitive' as any } } },
            ]
        } : {};

        const [vehicles, total] = await Promise.all([
            prisma.vehicle.findMany({
                where,
                include: {
                    user: true,
                },
                orderBy: {
                    createdAt: "desc",
                },
                skip,
                take,
                distinct: ['id'],
            }),
            prisma.vehicle.count({ where })
        ]);

        // Ultima foto capturada por matricula (ultimo AccessEvent con snapshot)
        const plates = (vehicles as any[]).map(v => v.plate).filter(Boolean).map(p => String(p).toUpperCase());
        const photoMap: Record<string, string> = {};
        if (plates.length > 0) {
            try {
                const rows: any[] = await prisma.$queryRawUnsafe(`
                    SELECT DISTINCT ON (UPPER("plateDetected")) UPPER("plateDetected") AS plate, "snapshotPath"
                    FROM "AccessEvent"
                    WHERE UPPER("plateDetected") IN (${plates.map(p => `'${p.replace(/'/g, "''")}'`).join(',')})
                      AND "snapshotPath" IS NOT NULL AND "snapshotPath" <> ''
                    ORDER BY UPPER("plateDetected"), timestamp DESC
                `);
                for (const r of rows) photoMap[r.plate] = r.snapshotPath;
            } catch (e) { /* noop */ }
        }
        // Ultima deteccion (cualquier evento) por matricula
        const lastSeenMap: Record<string, string> = {};
        if (plates.length > 0) {
            try {
                const rows2: any[] = await prisma.$queryRawUnsafe(`
                    SELECT DISTINCT ON (UPPER("plateDetected")) UPPER("plateDetected") AS plate, timestamp
                    FROM "AccessEvent"
                    WHERE UPPER("plateDetected") IN (${plates.map(p => `'${p.replace(/'/g, "''")}'`).join(',')})
                    ORDER BY UPPER("plateDetected"), timestamp DESC
                `);
                for (const r of rows2) lastSeenMap[r.plate] = r.timestamp;
            } catch (e) { /* noop */ }
        }
        const enriched = (vehicles as any[]).map(v => ({ ...v, lastPhoto: v.plate ? (photoMap[String(v.plate).toUpperCase()] || null) : null, lastSeen: v.plate ? (lastSeenMap[String(v.plate).toUpperCase()] || null) : null }));
        return { vehicles: enriched, total };
    } catch (error) {
        console.error("Error fetching vehicles:", error);
        return { vehicles: [], total: 0 };
    }
}

export async function createVehicle(data: any) {
    try {
        const vehicle = await prisma.vehicle.create({
            data: {
                plate: data.plate.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                brand: data.brand,
                model: data.model,
                color: data.color,
                type: data.type || "SEDAN",
                notes: data.notes,
                userId: data.userId,
            },
        });

        // Also create a credential for this plate if it doesn't exist
        const credentialExists = await prisma.credential.findFirst({
            where: { value: vehicle.plate, type: "PLATE" }
        });

        if (!credentialExists) {
            await prisma.credential.create({
                data: {
                    type: "PLATE",
                    value: vehicle.plate,
                    userId: data.userId,
                }
            });
        }

        revalidatePath("/admin/vehicles");
        return { success: true, vehicle };
    } catch (error: any) {
        console.error("Error creating vehicle:", error);
        return { success: false, error: error.message };
    }
}

export async function updateVehicle(id: string, data: any) {
    try {
        const vehicle = await prisma.vehicle.update({
            where: { id },
            data: {
                plate: data.plate.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                brand: data.brand,
                model: data.model,
                color: data.color,
                type: data.type,
                notes: data.notes,
                userId: data.userId,
            },
        });
        revalidatePath("/admin/vehicles");
        return { success: true, vehicle };
    } catch (error: any) {
        console.error("Error updating vehicle:", error);
        return { success: false, error: error.message };
    }
}

export async function deleteVehicle(id: string) {
    try {
        await prisma.vehicle.delete({
            where: { id },
        });
        revalidatePath("/admin/vehicles");
        return { success: true };
    } catch (error: any) {
        console.error("Error deleting vehicle:", error);
        return { success: false, error: error.message };
    }
}

export async function getVehicleHistory(plate: string) {
    try {
        const events = await prisma.accessEvent.findMany({
            where: {
                OR: [
                    { plateDetected: plate },
                    { plateNumber: plate }
                ]
            },
            include: {
                device: true,
                user: true
            },
            orderBy: {
                timestamp: "desc"
            },
            take: 50
        });
        return { success: true, events };
    } catch (error: any) {
        console.error("Error fetching vehicle history:", error);
        return { success: false, error: error.message, events: [] };
    }
}
