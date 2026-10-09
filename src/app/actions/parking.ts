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

// ───────────────────────────── Asignar plaza desde el monitor ─────────────────────────────
//
// La plaza es de una PERSONA (User.parkingSlotId, una por persona y una persona por plaza),
// y la matrícula llega a la plaza a través de su dueño (Vehicle.userId). Por eso asignar
// "una plaza a una matrícula" son hasta dos pasos: decir de quién es la matrícula, si no se
// sabía, y darle la plaza a esa persona.

async function quienOpera(): Promise<string> {
    const { getSession } = await import("@/app/actions/auth");
    const s: any = await getSession().catch(() => null);
    if (!s) throw new Error("Sesión vencida: volvé a entrar.");
    return String(s.name || s.sub || "panel");
}
const normChapa = (p: string) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Lo que el cajón necesita: el dueño de la matrícula (si hay), su plaza, y todas las plazas del plano. */
export async function datosPlaza(plate: string) {
    await quienOpera();
    const P = normChapa(plate);
    const [veh, slots, mapRow] = await Promise.all([
        P ? prisma.vehicle.findFirst({ where: { plate: { equals: P, mode: "insensitive" } }, select: { user: { select: { id: true, name: true, role: true, parkingSlotId: true, unit: { select: { name: true, number: true } } } } } }) : null,
        prisma.parkingSlot.findMany({ select: { id: true, label: true, points: true, user: { select: { id: true, name: true } } } }),
        prisma.setting.findUnique({ where: { key: "parking_map_url" } }),
    ]);
    // Orden natural: P-2 antes que P-10.
    slots.sort((a, b) => a.label.localeCompare(b.label, "es", { numeric: true }));
    const u = veh?.user || null;
    return {
        plate: P,
        mapUrl: mapRow?.value || null,
        duenio: u ? { id: u.id, nombre: u.name, rol: String(u.role), unidad: u.unit?.name || null, plazaId: u.parkingSlotId } : null,
        plazas: slots.map((s) => ({ id: s.id, label: s.label, points: s.points, ocupadaPor: s.user ? { id: s.user.id, nombre: s.user.name } : null })),
    };
}

/** Personas para elegir dueño. Sin la lista negra: darle una plaza contradice la lista. */
export async function buscarPersonasParaPlaza(q: string) {
    await quienOpera();
    const t = String(q || "").trim();
    const filas = await prisma.user.findMany({
        where: { role: { not: "BLACKLISTED" as any }, ...(t ? { OR: [{ name: { contains: t, mode: "insensitive" } }, { unit: { name: { contains: t, mode: "insensitive" } } }] } : {}) },
        select: { id: true, name: true, role: true, parkingSlot: { select: { label: true } }, unit: { select: { name: true } } },
        orderBy: { name: "asc" }, take: 20,
    });
    return filas.map((u) => ({ id: u.id, nombre: u.name, rol: String(u.role), unidad: u.unit?.name || null, plaza: u.parkingSlot?.label || null }));
}

/**
 * Dar (o sacar, con slotId null) la plaza a la persona dueña de la matrícula. Si la
 * matrícula no tenía dueño, se le pone `userId` como dueño. Si la plaza es de otra
 * persona, no se pisa salvo `reasignar`: sacarle la plaza a un vecino tiene que ser a
 * propósito.
 */
export async function asignarPlaza(d: { plate: string; userId: string; slotId: string | null; reasignar?: boolean }): Promise<{ ok: true; label: string | null } | { ok: false; error: string; ocupadaPor?: string }> {
    try {
        await quienOpera();
        const P = normChapa(d.plate);
        if (!P) return { ok: false, error: "Falta la matrícula." };
        const user = await prisma.user.findUnique({ where: { id: d.userId }, select: { id: true, name: true, role: true } });
        if (!user) return { ok: false, error: "Esa persona ya no existe." };
        if (String(user.role) === "BLACKLISTED") return { ok: false, error: `${user.name} está en lista negra.` };

        const veh = await prisma.vehicle.findFirst({ where: { plate: { equals: P, mode: "insensitive" } }, select: { id: true, userId: true, user: { select: { name: true } } } });
        if (veh && veh.userId !== user.id) return { ok: false, error: `${P} ya es de ${veh.user?.name || "otra persona"}. Cambiala desde su ficha.` };

        let label: string | null = null;
        if (d.slotId) {
            const slot = await prisma.parkingSlot.findUnique({ where: { id: d.slotId }, select: { id: true, label: true, user: { select: { id: true, name: true } } } });
            if (!slot) return { ok: false, error: "Esa plaza ya no existe." };
            if (slot.user && slot.user.id !== user.id && !d.reasignar) return { ok: false, error: `La plaza ${slot.label} es de ${slot.user.name}.`, ocupadaPor: slot.user.name };
            label = slot.label;
        }

        await prisma.$transaction(async (tx) => {
            if (!veh) await tx.vehicle.create({ data: { plate: P, userId: user.id } });
            if (d.slotId) {
                // La plaza es de una sola persona: si era de otra, se le saca primero.
                await tx.user.updateMany({ where: { parkingSlotId: d.slotId, NOT: { id: user.id } }, data: { parkingSlotId: null } });
            }
            await tx.user.update({ where: { id: user.id }, data: { parkingSlotId: d.slotId } });
        });
        return { ok: true, label };
    } catch (e: any) {
        return { ok: false, error: e?.message || "No se pudo asignar la plaza." };
    }
}
