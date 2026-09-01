import { prisma } from "../lib/prisma";
import { DeviceBrand } from "@prisma/client";
import { HikvisionDriver } from "../lib/drivers/HikvisionDriver";
import { AkuvoxDriver } from "../lib/drivers/AkuvoxDriver";
import { IntelbrasDriver } from "../lib/drivers/IntelbrasDriver";
import { DahuaDriver } from "../lib/drivers/DahuaDriver";
import { ZKTecoDriver } from "../lib/drivers/ZKTecoDriver";
import { AvicamDriver } from "../lib/drivers/AvicamDriver";
import { MilesightDriver } from "../lib/drivers/MilesightDriver";
import { UnifiDriver } from "../lib/drivers/UnifiDriver";
import { UniviewDriver } from "../lib/drivers/UniviewDriver";
import { IDeviceDriver } from "../lib/drivers/IDeviceDriver";

const hikvisionDriver = new HikvisionDriver();
const akuvoxDriver = new AkuvoxDriver();
const intelbrasDriver = new IntelbrasDriver();
const dahuaDriver = new DahuaDriver();
const zktecoDriver = new ZKTecoDriver();
const avicamDriver = new AvicamDriver();
const milesightDriver = new MilesightDriver();
const unifiDriver = new UnifiDriver();
const univiewDriver = new UniviewDriver();

export function getDriver(brand: DeviceBrand): IDeviceDriver {
    switch (brand) {
        case DeviceBrand.HIKVISION: return hikvisionDriver;
        case DeviceBrand.AKUVOX:    return akuvoxDriver;
        case DeviceBrand.INTELBRAS: return intelbrasDriver;
        case DeviceBrand.DAHUA:     return dahuaDriver;
        case DeviceBrand.ZKTECO:    return zktecoDriver;
        case DeviceBrand.AVICAM:    return avicamDriver;
        case DeviceBrand.MILESIGHT: return milesightDriver;
        case DeviceBrand.UNIFI:     return unifiDriver;
        case DeviceBrand.UNIVIEW:   return univiewDriver;
        default:
            throw new Error(`Unsupported device brand: ${brand}`);
    }
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sync a credential to all devices in the user's access groups.
 * Includes retry logic with exponential backoff and per-device failure tracking.
 */
export async function syncToDevices(credentialId: string) {
    try {
        const credential = await prisma.credential.findUnique({
            where: { id: credentialId },
            include: {
                user: {
                    include: {
                        accessGroups: {
                            include: {
                                devices: true,
                            },
                        },
                    },
                },
            },
        });

        if (!credential || !credential.user) {
            console.warn(`[LiveSync] Credential ${credentialId} not found or has no user.`);
            return;
        }

        // Deduplicate devices across access groups
        const devicesMap = new Map<string, any>();
        for (const group of credential.user.accessGroups) {
            for (const device of group.devices) {
                devicesMap.set(device.id, device);
            }
        }

        const devices = Array.from(devicesMap.values());

        const results: { deviceId: string; deviceIp: string; brand: string; success: boolean; error?: string }[] = [];

        const promises = devices.map(async (device) => {
            let lastError: string | undefined;

            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                try {
                    const driver = getDriver(device.brand);
                    await driver.upsertCredential(credential, device);
                    results.push({ deviceId: device.id, deviceIp: device.ip, brand: device.brand, success: true });
                    return; // Success, exit retry loop
                } catch (error: any) {
                    lastError = error.message;
                    if (attempt < MAX_RETRIES) {
                        const delay = RETRY_DELAY_MS * (attempt + 1); // Linear backoff
                        console.warn(`[LiveSync] ✗ Attempt ${attempt + 1} failed for ${device.ip}: ${error.message}. Retrying in ${delay}ms...`);
                        await sleep(delay);
                    }
                }
            }

            // All retries exhausted
            console.error(`[LiveSync] ✗ FAILED after ${MAX_RETRIES + 1} attempts for ${device.brand} ${device.ip}: ${lastError}`);
            results.push({ deviceId: device.id, deviceIp: device.ip, brand: device.brand, success: false, error: lastError });
        });

        await Promise.all(promises);

        // Summary
        const failed = results.filter(r => !r.success);
        if (failed.length > 0) {
            console.warn(`[LiveSync] Summary: ${results.length - failed.length}/${results.length} devices synced. Failed: ${failed.map(f => f.deviceIp).join(', ')}`);
        } else {
        }

        return results;
    } catch (error) {
        console.error("[LiveSync] Critical Error:", error);
        return [];
    }
}
