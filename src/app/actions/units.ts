"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

import { UnitType } from "@prisma/client";

export async function createUnit(formData: FormData) {
    const name = formData.get("name") as string;
    const type = formData.get("type") as UnitType; // BARRIO, EDIFICIO, CASA
    const floors = formData.get("floors") ? parseInt(formData.get("floors") as string) : null;
    const lot = formData.get("lot") as string;
    const houseNumber = formData.get("houseNumber") as string;
    const address = formData.get("address") as string;
    const adminPhone = formData.get("adminPhone") as string;
    const deviceCount = formData.get("deviceCount") ? parseInt(formData.get("deviceCount") as string) : 0;
    const deviceType = formData.get("deviceType") as string;
    const coordinates = formData.get("coordinates") as string;

    const mapPoints = formData.get("mapPoints") as string;
    const contactName = formData.get("contactName") as string;
    const contactEmail = formData.get("contactEmail") as string;
    const parentId = formData.get("parentId") as string;

    // Description can be mapped from address or kept empty
    const description = address ? `Ubicado en ${address}` : null;

    const unit = await prisma.unit.create({
        data: {
            name,
            description,
            type: type || 'EDIFICIO',
            floors,
            lot,
            houseNumber,
            address,
            adminPhone,
            deviceCount,
            deviceType,
            coordinates,
            mapPoints,
            contactName,
            contactEmail,
            parentId: parentId || null
        },
    });

    revalidatePath("/admin/units");
    return unit;
}

export async function updateUnit(id: string, formData: FormData) {
    const name = formData.get("name") as string;
    const type = formData.get("type") as UnitType;
    const floors = formData.get("floors") ? parseInt(formData.get("floors") as string) : null;
    const lot = formData.get("lot") as string;
    const houseNumber = formData.get("houseNumber") as string;
    const address = formData.get("address") as string;
    const adminPhone = formData.get("adminPhone") as string;
    const deviceCount = formData.get("deviceCount") ? parseInt(formData.get("deviceCount") as string) : 0;
    const deviceType = formData.get("deviceType") as string;
    const coordinates = formData.get("coordinates") as string;

    const mapPoints = formData.get("mapPoints") as string;
    const contactName = formData.get("contactName") as string;
    const contactEmail = formData.get("contactEmail") as string;
    const parentId = formData.get("parentId") as string;

    const description = address ? `Ubicado en ${address}` : null;

    await prisma.unit.update({
        where: { id },
        data: {
            name,
            description,
            type: type || 'EDIFICIO',
            floors,
            lot,
            houseNumber,
            address,
            adminPhone,
            deviceCount,
            deviceType,
            coordinates,
            mapPoints,
            contactName,
            contactEmail,
            parentId: parentId || null
        },
    });

    revalidatePath("/admin/units");
}

export async function deleteUnit(id: string) {
    await prisma.unit.delete({ where: { id } });
    revalidatePath("/admin/units");
}

export async function getUnits() {
    return await prisma.unit.findMany({
        orderBy: { name: 'asc' }
    });
}

export async function getUnitsWithDetails() {
    try {
        const allUnits = await prisma.unit.findMany({
            include: {
                users: {
                    include: {
                        credentials: true,
                        vehicles: true
                    }
                }
            },
            orderBy: { name: 'asc' }
        });

        // Organize hierarchy manually to avoid Prisma Client sync issues on Windows
        const unitMap = new Map();
        allUnits.forEach(u => unitMap.set(u.id, { ...u, children: [] }));

        allUnits.forEach(u => {
            const unit = unitMap.get(u.id);
            if (u.parentId && unitMap.has(u.parentId)) {
                unitMap.get(u.parentId).children.push(unit);
            }
        });

        return Array.from(unitMap.values());
    } catch (error: any) {
        // Log error both to console and a dedicated file we can easily check
        console.error("[ACTION ERROR] getUnitsWithDetails:", error);
        return []; // Return empty array to avoid crashing, but we'll see the log
    }
}

export async function bulkCreateSubUnits(parentId: string, pattern: string) {
    // pattern: "A-Z, 13"
    // We will generate A01-A13, B01-B13... Z01-Z13
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const count = 13;

    const parent = await prisma.unit.findUnique({ where: { id: parentId } });
    if (!parent) return;

    for (const char of letters) {
        for (let i = 1; i <= count; i++) {
            const houseNum = i.toString().padStart(2, '0');
            const unitName = `${char}${houseNum}`;
            const label = `Lote ${char} Casa ${houseNum}`;

            // Check if already exists for this parent
            const exists = await prisma.unit.findFirst({
                where: {
                    parentId,
                    name: unitName
                }
            });

            if (!exists) {
                await prisma.unit.create({
                    data: {
                        name: unitName,
                        description: `Unidad del complejo ${parent.name}`,
                        type: 'CASA',
                        lot: char,
                        houseNumber: houseNum,
                        parentId: parentId,
                        address: parent.address
                    }
                });
            }
        }
    }

    revalidatePath("/admin/units");
}
export async function getAvailableUsers() {
    return await prisma.user.findMany({
        where: {
            unitId: null
        },
        orderBy: {
            name: 'asc'
        }
    });
}

export async function assignUserToUnit(userId: string, unitId: string) {
    await prisma.user.update({
        where: { id: userId },
        data: { unitId }
    });
    revalidatePath("/admin/units");
}

export async function unassignUserFromUnit(userId: string) {
    await prisma.user.update({
        where: { id: userId },
        data: { unitId: null }
    });
    revalidatePath("/admin/units");
}
