"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import * as fs from 'fs';
import * as path from 'path';

export async function getParkingSlots() {
    try {
        const slots = await prisma.parkingSlot.findMany({
            orderBy: { createdAt: 'asc' }
        });

        // Parse points JSON string to array
        return slots.map(slot => ({
            ...slot,
            points: slot.points ? JSON.parse(slot.points) : []
        }));
    } catch (error) {
        console.error("Error fetching parking slots:", error);
        return [];
    }
}

export async function saveParkingSlots(slotsJson: string) {
    try {
        // Parse the JSON string to get the actual slots array
        const slots = JSON.parse(slotsJson);

        // Delete all existing slots
        await prisma.parkingSlot.deleteMany({});

        // Create new slots with polygon format
        for (const slot of slots) {
            const pointsJson = JSON.stringify(slot.points || []);

            await prisma.parkingSlot.create({
                data: {
                    id: slot.id,
                    label: slot.label,
                    isOccupied: slot.isOccupied || false,
                    unitId: slot.unitId || null,
                    // Store polygon points as JSON
                    points: pointsJson,
                    // Legacy fields for backward compatibility
                    x: slot.points?.[0]?.x || 0,
                    y: slot.points?.[0]?.y || 0,
                    width: 0,
                    height: 0
                }
            });
        }

        revalidatePath("/admin/plazas");
        return { success: true, message: "Configuración guardada exitosamente" };
    } catch (error: any) {
        console.error("Error saving parking slots:", error);
        return { success: false, error: error.message || "Failed to save slots" };
    }
}

export async function updateSlotStatus(id: string, isOccupied: boolean) {
    try {
        await prisma.parkingSlot.update({
            where: { id },
            data: { isOccupied }
        });
        revalidatePath("/admin/plazas");
        return { success: true };
    } catch (error) {
        console.error("Error updating slot status:", error);
        return { success: false };
    }
}

export async function getParkingMap() {
    const setting = await prisma.setting.findUnique({ where: { key: "parking_map_url" } });
    return setting?.value || null;
}

import { uploadToS3 } from "@/lib/s3";

export async function uploadParkingMap(formData: FormData) {
    const file = formData.get("file") as File;
    if (!file) throw new Error("No file provided");

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const filename = `maps/parking_map_${Date.now()}.png`;
    const url = await uploadToS3(buffer, filename, file.type || "image/png", "lpr");

    await prisma.setting.upsert({
        where: { key: "parking_map_url" },
        update: { value: url },
        create: { key: "parking_map_url", value: url }
    });

    revalidatePath("/admin/plazas");
    return url;
}

export async function getParkingElements() {
    try {
        const s = await prisma.setting.findUnique({ where: { key: "parking_map_elements" } });
        if (!s?.value) return { entradas: [], salidas: [], calles: [] };
        const d = JSON.parse(s.value);
        return { entradas: d.entradas || [], salidas: d.salidas || [], calles: d.calles || [] };
    } catch {
        return { entradas: [], salidas: [], calles: [] };
    }
}

export async function saveParkingElements(json: string) {
    try {
        const d = JSON.parse(json);
        const clean = { entradas: d.entradas || [], salidas: d.salidas || [], calles: d.calles || [] };
        await prisma.setting.upsert({
            where: { key: "parking_map_elements" },
            update: { value: JSON.stringify(clean) },
            create: { key: "parking_map_elements", value: JSON.stringify(clean) },
        });
        revalidatePath("/admin/plazas");
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e?.message };
    }
}


// Ocupación por LPR: verde = auto adentro, rojo = auto asignado pero afuera, none = sin vehículo asignado.
export type SlotOccupancy = { status: "in" | "out" | "none"; inside: string[]; all: string[] };
export async function getParkingOccupancy(): Promise<Record<string, SlotOccupancy>> {
    try {
        const slots = await prisma.parkingSlot.findMany({ select: { id: true, unitId: true } });
        const users = await prisma.user.findMany({
            where: { OR: [{ parkingSlotId: { not: null } }, { unitId: { not: null } }] },
            select: { parkingSlotId: true, unitId: true, vehicles: { select: { plate: true } } },
        });
        const platesBySlot: Record<string, Set<string>> = {};
        const add = (slotId: string, plate: string) => { (platesBySlot[slotId] ||= new Set()).add(plate.toUpperCase()); };
        // asignación directa usuario->plaza
        for (const u of users) if (u.parkingSlotId) u.vehicles.forEach((v) => add(u.parkingSlotId as string, v.plate));
        // fallback por unidad
        const platesByUnit: Record<string, string[]> = {};
        for (const u of users) if (u.unitId) u.vehicles.forEach((v) => (platesByUnit[u.unitId as string] ||= []).push(v.plate));
        for (const s of slots) if (s.unitId && platesByUnit[s.unitId] && !platesBySlot[s.id]) platesByUnit[s.unitId].forEach((p) => add(s.id, p));

        const allPlates = [...new Set(Object.values(platesBySlot).flatMap((set) => [...set]))];
        const dir: Record<string, string> = {};
        if (allPlates.length) {
            const rows: any[] = await prisma.$queryRaw`SELECT DISTINCT ON ("plateDetected") "plateDetected", direction FROM "AccessEvent" WHERE "plateDetected" = ANY(${allPlates}) ORDER BY "plateDetected", "timestamp" DESC`;
            for (const r of rows) dir[(r.plateDetected || "").toUpperCase()] = r.direction;
        }
        const result: Record<string, SlotOccupancy> = {};
        for (const [slotId, set] of Object.entries(platesBySlot)) {
            const plates = [...set];
            const inside = plates.filter((p) => dir[p] === "ENTRY");
            result[slotId] = { status: inside.length ? "in" : (plates.length ? "out" : "none"), inside, all: plates };
        }
        return result;
    } catch (e) {
        console.error("[getParkingOccupancy]", e);
        return {};
    }
}
