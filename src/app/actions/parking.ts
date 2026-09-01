"use server";
import { prisma } from "@/lib/prisma";

export async function getParkingSlots() {
    return await prisma.parkingSlot.findMany({
        orderBy: { label: 'asc' },
        include: { user: { select: { id: true, name: true } } }
    });
}

// Ubicación de una matrícula: resuelve plate -> vehículo -> usuario -> plaza (directa o vía unidad) + plano.
export async function getPlateParking(plate: string) {
    try {
        const P = (plate || "").trim();
        if (!P) return { found: false as const };
        const mapRow = await prisma.setting.findUnique({ where: { key: "parking_map_url" } });
        const mapUrl = mapRow?.value || null;
        const vehicles = await prisma.vehicle.findMany({ where: { plate: { equals: P, mode: "insensitive" } }, select: { userId: true } });
        const userIds = [...new Set(vehicles.map((v) => v.userId))];
        if (!userIds.length) return { found: false as const, mapUrl };
        const users = await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: {
                name: true, unitId: true,
                parkingSlot: { select: { id: true, label: true, points: true, unitId: true } },
                unit: { select: { id: true, number: true, name: true } },
            },
        });
        let slot: any = null, unit: any = null, resident: string | null = null;
        const direct = users.find((u) => u.parkingSlot);
        if (direct) { slot = direct.parkingSlot; unit = direct.unit; resident = direct.name; }
        else {
            const withUnit = users.find((u) => u.unitId);
            if (withUnit) { slot = await prisma.parkingSlot.findFirst({ where: { unitId: withUnit.unitId }, select: { id: true, label: true, points: true, unitId: true } }); unit = withUnit.unit; resident = withUnit.name; }
        }
        if (!slot) return { found: false as const, mapUrl, resident: users[0]?.name || null, unitNumber: users[0]?.unit?.number || null };
        return { found: true as const, mapUrl, label: slot.label, points: slot.points, unitNumber: unit?.number || null, unitName: unit?.name || null, resident };
    } catch (e) {
        console.error("[getPlateParking]", e);
        return { found: false as const };
    }
}

// Matrículas que tienen una plaza asignada (directa o vía unidad) — para colorear el ícono.
export async function getPlatesWithParking(): Promise<string[]> {
    try {
        const slots = await prisma.parkingSlot.findMany({ select: { unitId: true } });
        const unitIds = [...new Set(slots.map((s) => s.unitId).filter(Boolean) as string[])];
        const directUsers = await prisma.user.findMany({ where: { parkingSlotId: { not: null } }, select: { vehicles: { select: { plate: true } } } });
        const unitUsers = unitIds.length ? await prisma.user.findMany({ where: { unitId: { in: unitIds } }, select: { vehicles: { select: { plate: true } } } }) : [];
        const plates = new Set<string>();
        for (const u of [...directUsers, ...unitUsers]) for (const v of u.vehicles) if (v.plate) plates.add(v.plate.toUpperCase());
        return [...plates];
    } catch (e) { console.error("[getPlatesWithParking]", e); return []; }
}
