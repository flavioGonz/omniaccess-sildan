import { prisma } from "./prisma";
import { DeviceBrand } from "@prisma/client";
import { HikvisionDriver } from "./drivers/HikvisionDriver";
import { isLprDriver } from "./drivers/IDeviceDriver";

// Use shared driver instances (same as liveSync.ts)
const hikvisionDriver = new HikvisionDriver();

function getLprDriver(brand: DeviceBrand) {
    switch (brand) {
        case DeviceBrand.HIKVISION:
            return hikvisionDriver;
        default:
            return null; // Only Hikvision has LPR implemented for now
    }
}

/**
 * Bi-directional plate sync: removes "zombie" plates from devices
 * that no longer exist in the database.
 * Uses the shared Prisma singleton and the driver interface system.
 */
export async function syncPlates() {

    const devices = await prisma.device.findMany({
        where: { deviceType: "LPR_CAMERA" }
    });

    if (devices.length === 0) {
        return;
    }

    const dbCredentials = await prisma.credential.findMany({
        where: { type: "PLATE" }
    });
    const dbPlates = new Set(dbCredentials.map(c => c.value));

    for (const device of devices) {
        const driver = getLprDriver(device.brand);
        if (!driver || !isLprDriver(driver)) {
            continue;
        }


        try {
            const devicePlates = await driver.getPlates(device);
            let removedCount = 0;

            for (const plate of devicePlates) {
                if (!dbPlates.has(plate)) {
                    try {
                        await driver.deleteCredential(plate, device);
                        removedCount++;
                    } catch (e: any) {
                        console.error(`Failed to remove plate ${plate} from ${device.ip}: ${e.message}`);
                    }
                }
            }

        } catch (e: any) {
            console.error(`Failed to sync device ${device.ip}: ${e.message}`);
        }
    }
}
