"use server";

import { prisma } from "@/lib/prisma";
import { HikvisionDriver } from "@/lib/drivers/HikvisionDriver";
import { revalidatePath } from "next/cache";
import axios from "axios";
import { registerFaceInCompereFace } from "./face-verify";

export async function syncFaceToAllDevicesAction(userId: string) {
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { credentials: true }
        });

        if (!user) return { success: false, error: "User not found" };

        const devices = await prisma.device.findMany({
            where: {
                OR: [
                    { deviceType: 'FACE_TERMINAL' },
                    { deviceType: 'LPR_CAMERA' } // Some LPR cameras support face logic
                ]
            }
        });

        if (devices.length === 0) return { success: true, message: "No compatible devices for face sync" };

        const results = [];
        const driver = new HikvisionDriver();

        for (const device of devices) {
            if (device.brand === 'HIKVISION') {
                try {
                    await driver.syncUserWithFace(user, device);
                    results.push({ name: device.name, status: 'success' });
                } catch (err: any) {
                    console.error(`[Face Sync] Failed for ${device.name}:`, err.message);
                    results.push({ name: device.name, status: 'failed', error: err.message });
                }
            } else {
                results.push({ name: device.name, status: 'skipped', reason: 'Non-Hikvision not implemented' });
            }
        }

        return { success: true, results };
    } catch (error: any) {
        console.error("[Face Sync] Critical failure:", error.message);
        return { success: false, error: error.message };
    }
}

export async function syncAllBlacklistAction() {
    try {
        const blacklist = await prisma.user.findMany({
            where: { role: 'BLACKLISTED' },
            include: { credentials: true }
        });

        if (blacklist.length === 0) return { success: true, message: "No subjects in blacklist to sync" };

        const devices = await prisma.device.findMany({
            where: {
                OR: [
                    { deviceType: 'FACE_TERMINAL' },
                    { deviceType: 'LPR_CAMERA' }
                ]
            }
        });

        const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:10001").replace(/\/$/, "");
        const driver = new HikvisionDriver();
        const results = [];

        for (const user of blacklist) {

            // 1. Sync to Devices
            for (const device of devices) {
                if (device.brand === 'HIKVISION') {
                    try {
                        await driver.syncUserWithFace(user, device);
                    } catch (err: any) {
                        console.warn(`[Full Sync] Device ${device.name} failed for ${user.name}:`, err.message);
                    }
                }
            }

            // 2. Sync to Neural Engine (Ensuring they are in Main collection)
            if (user.cara) {
                try {
                    const imgUrl = user.cara.startsWith('http') ? user.cara : `${appUrl}${user.cara}`;
                    const imgResponse = await axios.get(imgUrl, { responseType: 'arraybuffer' });
                    await registerFaceInCompereFace(user.name, Buffer.from(imgResponse.data));
                } catch (err: any) {
                    console.warn(`[Full Sync] Neural engine failed for ${user.name}:`, err.message);
                }
            }

            results.push(user.name);
        }

        revalidatePath("/admin/dashboard-face/blacklist");
        return { success: true, count: results.length };
    } catch (error: any) {
        console.error("[Full Sync] Critical error:", error.message);
        return { success: false, error: error.message };
    }
}

