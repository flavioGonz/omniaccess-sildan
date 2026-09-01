"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { HikvisionDriver } from "@/lib/drivers/HikvisionDriver";
import { Credential } from "@prisma/client";

export async function getCredentials() {
    return await prisma.credential.findMany({
        include: {
            user: {
                include: {
                    unit: true
                }
            }
        },
        orderBy: {
            createdAt: 'desc'
        }
    });
}

export async function deleteCredential(id: string) {
    const credential = await prisma.credential.findUnique({ where: { id } });

    if (credential && credential.type === "PLATE") {
        const hikDevices = await prisma.device.findMany({ where: { brand: "HIKVISION", deviceType: "LPR_CAMERA" } });
        const driver = new HikvisionDriver();
        for (const dev of hikDevices) {
            try {
                await driver.deleteCredential(credential.value, dev);
            } catch (err) {
                console.error(`Failed to delete plate from device ${dev.ip}:`, err);
            }
        }
    }

    await prisma.credential.delete({ where: { id } });
    revalidatePath("/admin/credentials");
    revalidatePath("/admin/users");
}

export async function createCredential(formData: FormData) {
    const userId = formData.get("userId") as string;
    const type = formData.get("type") as "PLATE" | "FACE" | "TAG";
    const value = formData.get("value") as string;

    if (!userId || !type || !value) {
        throw new Error("Missing required fields");
    }

    // Check if duplicate value exists for unique constraint logic (though schema might not enforce unique globally on value, logic dictates it usually)
    // Actually schema doesn't say value is unique in Credential model, but User-Credential usually 1:M.
    // However, same plate for 2 users is rare/bad. 
    // We'll just create.

    const credential = await prisma.credential.create({
        data: {
            userId,
            type,
            value
        }
    });

    if (type === "PLATE") {
        const hikDevices = await prisma.device.findMany({ where: { brand: "HIKVISION", deviceType: "LPR_CAMERA" } });
        const driver = new HikvisionDriver();
        for (const dev of hikDevices) {
            try {
                await driver.upsertCredential(credential, dev);
            } catch (err) {
                console.error(`Failed to push plate to device ${dev.ip}:`, err);
            }
        }
    }

    revalidatePath("/admin/credentials");
    revalidatePath("/admin/users");
}

export async function updateCredential(id: string, formData: FormData) {
    const userId = formData.get("userId") as string;
    const type = formData.get("type") as "PLATE" | "FACE" | "TAG";
    const value = formData.get("value") as string;

    const oldCredential = await prisma.credential.findUnique({ where: { id } });
    const newCredential = await prisma.credential.update({
        where: { id },
        data: {
            userId,
            type,
            value
        }
    });

    if (newCredential.type === "PLATE") {
        const hikDevices = await prisma.device.findMany({ where: { brand: "HIKVISION", deviceType: "LPR_CAMERA" } });
        const driver = new HikvisionDriver();
        for (const dev of hikDevices) {
            try {
                // If the value changed, delete old one first
                if (oldCredential && oldCredential.value !== newCredential.value) {
                    await driver.deleteCredential(oldCredential.value, dev);
                }
                await driver.upsertCredential(newCredential, dev);
            } catch (err) {
                console.error(`Failed to update plate on device ${dev.ip}:`, err);
            }
        }
    }

    revalidatePath("/admin/credentials");
    revalidatePath("/admin/users");
}
