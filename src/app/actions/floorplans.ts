"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function getFloorPlans() {
    return await prisma.floorPlan.findMany({
        orderBy: { order: 'asc' },
        include: { devices: true }
    });
}

export async function createFloorPlan(name: string, imagePath: string) {
    const floorPlan = await prisma.floorPlan.create({
        data: { name, imagePath }
    });
    revalidatePath("/admin/dashboard-face");
    return floorPlan;
}

export async function deleteFloorPlan(id: string) {
    await prisma.floorPlan.delete({ where: { id } });
    revalidatePath("/admin/dashboard-face");
    return { success: true };
}

export async function updateDeviceFloorPosition(deviceId: string, floorPlanId: string | null, x: number, y: number) {
    await prisma.device.update({
        where: { id: deviceId },
        data: {
            floorPlanId,
            mapX: x,
            mapY: y
        }
    });
    revalidatePath("/admin/dashboard-face");
    return { success: true };
}

export async function removeDeviceFromFloor(deviceId: string) {
    await prisma.device.update({
        where: { id: deviceId },
        data: {
            floorPlanId: null,
            mapX: null,
            mapY: null
        }
    });
    revalidatePath("/admin/dashboard-face");
    return { success: true };
}
