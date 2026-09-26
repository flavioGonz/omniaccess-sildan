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


/** Mapa matrícula(MAYÚS) -> parkingSlotId, resolviendo por asignación directa o por unidad.
 *  Se usa en el mapa para resaltar el lote/casa del residente al detectar su matrícula. */
export async function getPlateSlotMap(): Promise<Record<string, string>> {
    const map: Record<string, string> = {};
    try {
        // Asignación directa: usuario con parkingSlotId
        const direct = await prisma.user.findMany({
            where: { parkingSlotId: { not: null } },
            select: { parkingSlotId: true, vehicles: { select: { plate: true } } },
        });
        for (const u of direct) for (const v of u.vehicles) if (v.plate && u.parkingSlotId) map[v.plate.toUpperCase()] = u.parkingSlotId;

        // Vía unidad: plaza con unitId -> usuarios de esa unidad
        const slots = await prisma.parkingSlot.findMany({ where: { unitId: { not: null } }, select: { id: true, unitId: true } });
        const byUnit: Record<string, string> = {};
        for (const sl of slots) if (sl.unitId && !byUnit[sl.unitId]) byUnit[sl.unitId] = sl.id;
        const unitIds = Object.keys(byUnit);
        if (unitIds.length) {
            const uu = await prisma.user.findMany({ where: { unitId: { in: unitIds } }, select: { unitId: true, vehicles: { select: { plate: true } } } });
            for (const u of uu) for (const v of u.vehicles) {
                const P = v.plate?.toUpperCase();
                if (P && u.unitId && byUnit[u.unitId] && !map[P]) map[P] = byUnit[u.unitId];
            }
        }
    } catch (e) { console.error("[getPlateSlotMap]", e); }
    return map;
}
