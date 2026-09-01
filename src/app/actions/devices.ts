"use server";

import { prisma } from "@/lib/prisma";
import { Device, DeviceBrand, DeviceDirection, DeviceType, AuthType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { HikvisionDriver } from "@/lib/drivers/HikvisionDriver";
import { uploadToS3 } from "@/lib/s3";

async function saveFile(file: any, folder: string): Promise<string | null> {
    if (!file || typeof file === 'string' || !file.size) return null;
    try {
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const filename = `${folder}/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;

        const fileUrl = await uploadToS3(buffer, filename, file.type || "image/jpeg", "lpr");
        return fileUrl;
    } catch (error) {
        console.error(`Error uploading file to S3 (${folder}):`, error);
        return null;
    }
}

export async function createDevice(formData: FormData) {
    const name = formData.get("name") as string;
    const ip = formData.get("ip") as string;
    const brand = formData.get("brand") as DeviceBrand;
    const deviceType = formData.get("deviceType") as DeviceType;
    const direction = formData.get("direction") as DeviceDirection;
    const location = formData.get("location") as string;
    const username = formData.get("username") as string;
    const password = formData.get("password") as string;
    let authType = formData.get("authType") as AuthType;
    const mac = formData.get("mac") as string;
    const groupId = formData.get("groupId") as string;
    // Hikvision LPR: por defecto DIGEST (evita snapshot 502 por Basic)
    if (brand === "HIKVISION" && (deviceType as any) === "LPR_CAMERA" && !authType) authType = "DIGEST" as AuthType;

    // Custom images
    const modelPhotoFile = formData.get("modelPhoto") as File;
    const brandLogoFile = formData.get("brandLogo") as File;

    const modelPhoto = await saveFile(modelPhotoFile, "devices");
    const brandLogo = await saveFile(brandLogoFile, "brands");

    const newDevice = await prisma.device.create({
        data: {
            name,
            ip,
            brand,
            deviceType,
            direction,
            location,
            username,
            password,
            authType,
            mac,
            modelPhoto,
            brandLogo,
            deviceModel: formData.get("deviceModel") as string,
            accessGroups: groupId && groupId !== "none" ? {
                connect: { id: groupId }
            } : undefined
        },
    });

    // Automatic sync on add
    try {
        const { syncHardwareLogs } = await import("@/app/actions/deviceMemory");
        await syncHardwareLogs(newDevice.id);
    } catch (err) {
        console.error("Auto-sync failed on device creation:", err);
    }

    // Auto-registrar el stream en go2rtc (LPR Hikvision)
    try {
        const { syncLprStream } = await import("@/lib/go2rtc-sync");
        await syncLprStream(newDevice as any);
    } catch (err) {
        console.error("go2rtc sync failed on create:", err);
    }

    revalidatePath("/admin/devices");
}

export async function updateDevice(id: string, formData: FormData) {
    const name = formData.get("name") as string;
    const ip = formData.get("ip") as string;
    const brand = formData.get("brand") as DeviceBrand;
    const deviceType = formData.get("deviceType") as DeviceType;
    const direction = formData.get("direction") as DeviceDirection;
    const location = formData.get("location") as string;
    const username = formData.get("username") as string;
    const password = formData.get("password") as string;
    let authType = formData.get("authType") as AuthType;
    const mac = formData.get("mac") as string;
    if (brand === "HIKVISION" && (deviceType as any) === "LPR_CAMERA" && !authType) authType = "DIGEST" as AuthType;

    // Custom images
    const modelPhotoFile = formData.get("modelPhoto") as File;
    const brandLogoFile = formData.get("brandLogo") as File;

    const modelPhoto = await saveFile(modelPhotoFile, "devices");
    const brandLogo = await saveFile(brandLogoFile, "brands");

    const deviceModel = formData.get("deviceModel") as string;

    await prisma.device.update({
        where: { id },
        data: {
            name,
            ip,
            brand,
            deviceType,
            direction,
            location,
            username,
            password,
            authType,
            mac,
            deviceModel,
            ...(modelPhoto && { modelPhoto }),
            ...(brandLogo && { brandLogo }),
        },
    });

    // Auto-registrar/actualizar el stream en go2rtc (LPR Hikvision)
    try {
        const { syncLprStream } = await import("@/lib/go2rtc-sync");
        await syncLprStream({ id, ip, username, password, brand, deviceType } as any);
    } catch (err) {
        console.error("go2rtc sync failed on update:", err);
    }

    revalidatePath("/admin/devices");
}

export async function deleteDevice(id: string) {
    await prisma.device.delete({ where: { id } });
    revalidatePath("/admin/devices");
}

export async function getDevices() {
    return await prisma.device.findMany({
        orderBy: { createdAt: 'desc' }
    });
}

export async function getDevicesCount() {
    return await prisma.device.count();
}

export async function testDeviceConnection(id: string) {
    try {
        const device = await prisma.device.findUnique({ where: { id } });
        if (!device) {
            return { success: false, message: "Device not found" };
        }

        if (device.brand === "HIKVISION") {
            try {
                const driver = new HikvisionDriver();
                // We'll use getPlates as a proxy for connection test
                const plates = await driver.getPlates(device);
                await prisma.device.update({
                    where: { id },
                    data: { lastOnlinePull: new Date() }
                });
                return {
                    success: true,
                    message: "Conectado a Hikvision",
                    details: `Placas en memoria: ${plates.length}`
                };
            } catch (error: any) {
                return {
                    success: false,
                    message: error.message || "Connection failed"
                };
            }
        }

        if (device.brand === "AKUVOX") {
            try {
                const { AkuvoxDriver } = await import("@/lib/drivers/AkuvoxDriver");
                const driver = new AkuvoxDriver();
                // We use any as any to access the private request for testing, 
                // or just use getDeviceStats. Let's use getDeviceStats as a proxy for connection.
                const stats = await driver.getDeviceStats(device);
                await prisma.device.update({
                    where: { id },
                    data: { lastOnlinePull: new Date() }
                });

                return {
                    success: true,
                    message: "Conectado a Akuvox",
                    details: `Identidades detectadas: ${stats.faces + stats.tags}`
                };
            } catch (error: any) {
                return {
                    success: false,
                    message: `Akuvox Error: ${error.message}`,
                };
            }
        }
        return { success: false, message: "Prueba de conexión no implementada para esta marca" };
    } catch (error: any) {
        return {
            success: false,
            message: error.message || "Error al intentar conectar",
            details: error.response?.data ? JSON.stringify(error.response.data) : "Timeout o IP no alcanzable"
        };
    }
}

export async function probeDeviceInfo(input: { ip: string; username?: string; password?: string; authType?: string; brand?: string; }) {
    const ip = (input.ip || "").trim();
    if (!ip) return { ok: false, error: "IP requerida" };
    const brand = (input.brand || "HIKVISION").toUpperCase();
    if (brand !== "HIKVISION") return { ok: false, error: "Autodeteccion disponible solo para HIKVISION por ahora" };
    const driver = new HikvisionDriver();
    const order = (input.authType || "DIGEST").toUpperCase() === "BASIC" ? ["BASIC", "DIGEST"] : ["DIGEST", "BASIC"];
    let lastErr = "";
    for (const a of order) {
        try {
            const dev: any = { ip, username: input.username || "admin", password: input.password || "", authType: a };
            const info = await driver.getDeviceInfo(dev);
            if (info && (info.model || info.macAddress || info.serialNumber)) {
                return { ok: true, online: true, authType: a, ...info };
            }
        } catch (e: any) {
            lastErr = e?.message || String(e);
        }
    }
    return { ok: false, online: false, error: lastErr || "Sin respuesta ISAPI (revisa IP/credenciales)" };
}

export async function triggerDeviceRelay(id: string) {
    try {
        const device = await prisma.device.findUnique({ where: { id } });
        if (!device) return { success: false, message: "Dispositivo no encontrado" };

        if (device.brand === "AKUVOX") {
            const { AkuvoxDriver } = await import("@/lib/drivers/AkuvoxDriver");
            const driver = new AkuvoxDriver();
            await driver.triggerRelay(device);
            return { success: true, message: "Relé activado" };
        }

        if (device.brand === "HIKVISION") {
            const driver = new HikvisionDriver();
            await driver.triggerRelay(device);
            return { success: true, message: "Comando de apertura enviado a Hikvision" };
        }

        return { success: false, message: "Marca no compatible con disparo remoto" };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}
export async function getDeviceStats(id: string) {
    try {
        const device = await prisma.device.findUnique({ where: { id } });
        if (!device) return { faces: 0, tags: 0, plates: 0 };

        if (device.brand === "AKUVOX") {
            const { AkuvoxDriver } = await import("@/lib/drivers/AkuvoxDriver");
            const driver = new AkuvoxDriver();
            const stats = await driver.getDeviceStats(device);
            // Non-blocking update
            prisma.device.update({ where: { id }, data: { lastOnlinePull: new Date() } }).catch(() => { });
            return { ...stats, plates: 0 };
        }

        if (device.brand === "HIKVISION") {
            const driver = new HikvisionDriver();
            const plates = await driver.getPlates(device);
            // Non-blocking update
            prisma.device.update({ where: { id }, data: { lastOnlinePull: new Date() } }).catch(() => { });
            return { faces: 0, tags: 0, plates: plates.length };
        }

        return { faces: 0, tags: 0, plates: 0 };
    } catch (error) {
        return { faces: 0, tags: 0, plates: 0 };
    }
}

export async function syncPlatesToDevice(deviceId: string) {
    try {
        const device = await prisma.device.findUnique({ where: { id: deviceId } });
        if (!device || device.brand !== "HIKVISION") {
            return { success: false, message: "Dispositivo no compatible para sincronización LPR" };
        }

        const plates = await prisma.credential.findMany({
            where: { type: "PLATE" }
        });

        const driver = new HikvisionDriver();

        // 1. Wipe the camera first for a TRUE mirror (Forzar Sincro)
        try {
            await driver.clearWhiteList(device);
        } catch (wipeError) {
            console.warn(`[Sync] Could not wipe camera, will attempt to append:`, wipeError);
        }

        let successCount = 0;
        let failCount = 0;

        for (const plate of plates) {
            try {
                await driver.upsertCredential(plate, device);
                successCount++;
            } catch (err) {
                failCount++;
            }
        }

        revalidatePath("/admin/devices");
        return {
            success: true,
            message: `Sincronización completada: ${successCount} exitosas, ${failCount} fallidas.`
        };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function getDevicePlates(id: string) {
    try {
        const device = await prisma.device.findUnique({ where: { id } });
        if (!device || device.brand !== "HIKVISION") {
            return { success: false, message: "Dispositivo no compatible", data: [] };
        }

        const driver = new HikvisionDriver();
        const plates = await driver.getPlatesFromCamera(device);

        return { success: true, data: plates };
    } catch (error: any) {
        return { success: false, message: error.message, data: [] };
    }
}

export async function getDevicePlatesPage(id: string, searchId: string, start: number) {
    try {
        const device = await prisma.device.findUnique({ where: { id } });
        if (!device || device.brand !== "HIKVISION") {
            return { success: false, message: "Dispositivo no compatible" };
        }

        const driver = new HikvisionDriver();
        const result = await driver.getPlatesPage(device, searchId, start);

        return { success: true, ...result };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function addDevicePlate(id: string, plate: string) {
    try {
        const device = await prisma.device.findUnique({ where: { id } });
        if (!device || device.brand !== "HIKVISION") {
            return { success: false, message: "Dispositivo no compatible" };
        }

        const driver = new HikvisionDriver();
        await driver.addPlateToCamera(device, plate);

        return { success: true, message: `Matrícula ${plate} añadida correctamente a la cámara.` };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function importPlateBatch(id: string, plates: string[]) {
    try {
        const device = await prisma.device.findUnique({ where: { id } });
        if (!device) return { success: false, message: "Dispositivo no encontrado" };

        let importedCount = 0;

        // Prefetch all existing credentials and vehicles in batch to avoid N+1
        const normalizedPlates = plates
            .map(p => p.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""))
            .filter(p => p.length >= 3);
        const [existingCreds, existingVehicles] = await Promise.all([
            prisma.credential.findMany({
                where: { type: 'PLATE', value: { in: normalizedPlates } }
            }),
            prisma.vehicle.findMany({
                where: { plate: { in: normalizedPlates } }
            })
        ]);
        const credMap = new Map(existingCreds.map(c => [c.value, c]));
        const vehicleMap = new Map(existingVehicles.map(v => [v.plate, v]));

        for (const rawPlate of plates) {
            // Normalización
            const plateNum = rawPlate.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (!plateNum || plateNum.length < 3) continue;

            // Use prefetched data instead of per-iteration queries
            const existingCred = credMap.get(plateNum) || null;
            const existingVehicle = vehicleMap.get(plateNum) || null;

            let userId = existingCred?.userId || existingVehicle?.userId;

            // Si no existe usuario asociado, creamos uno nuevo específico para esta matrícula
            if (!userId) {
                try {
                    const newUser = await prisma.user.create({
                        data: {
                            name: `Usuario ${plateNum}`,
                            dni: `IMP-${plateNum}`, // Generamos un ID único basado en la matrícula
                            phone: "N/A",
                            role: 'RESIDENT'
                        }
                    });
                    userId = newUser.id;
                    importedCount++;
                } catch (userError) {
                    console.error(`Error creando usuario para placa ${plateNum}`, userError);
                    // Si falla por unique constraint (ej. DNI duplicado por alguna razón), 
                    // intentamos buscar si ya existe un usuario con ese DNI para vincularlo (fallback)
                    const fallbackUser = await prisma.user.findFirst({ where: { dni: `IMP-${plateNum}` } });
                    if (fallbackUser) userId = fallbackUser.id;
                    else continue; // Si falla fatalmente, saltamos
                }
            }

            // Asegurar Credencial
            if (!existingCred && userId) {
                await prisma.credential.create({
                    data: {
                        type: 'PLATE',
                        value: plateNum,
                        userId: userId,
                        notes: `Importado de ${device.name}`
                    }
                });
            }

            // Asegurar Ficha Vehicular
            if (!existingVehicle && userId) {
                await prisma.vehicle.create({
                    data: {
                        plate: plateNum,
                        userId: userId,
                        brand: "LPR",
                        model: "IMPORTADO",
                        notes: `Sincro Hardware ${device.name}`
                    }
                });
            }
        }

        // Revalidar todas las rutas relacionadas
        revalidatePath("/admin/vehicles");
        revalidatePath("/admin/credentials");
        revalidatePath("/admin/devices");
        revalidatePath("/admin/dashboard");

        return { success: true, count: importedCount };
    } catch (error: any) {
        console.error("[ImportBatch] Error:", error);
        return { success: false, message: error.message };
    }
}

export async function getPlatesEnrichment() {
    try {
        // Query the latest 1000 events with plate info
        const events = await prisma.accessEvent.findMany({
            where: {
                plateNumber: { not: null },
                details: { contains: "Marca:" }
            },
            orderBy: { timestamp: "desc" },
            take: 2000
        });

        const enrichment: Record<string, { brand: string, color: string, model: string }> = {};

        events.forEach(event => {
            if (!event.plateNumber) return;
            const plate = event.plateNumber.toUpperCase();
            if (enrichment[plate]) return; // Already have latest

            const details = event.details || "";
            // Extract: Marca: Mitsubishi, Modelo: Unknown, Color: Gris, Tipo: Unknown, Source: Camera
            const brandMatch = details.match(/Marca:\s*(.*?),/);
            const modelMatch = details.match(/Modelo:\s*(.*?),/);
            const colorMatch = details.match(/Color:\s*(.*?),/);

            enrichment[plate] = {
                brand: brandMatch ? brandMatch[1].trim() : "Unknown",
                model: modelMatch ? modelMatch[1].trim() : "Unknown",
                color: colorMatch ? colorMatch[1].trim() : "Unknown"
            };
        });

        return enrichment;
    } catch (error) {
        console.error("Enrichment error:", error);
        return {};
    }
}

export async function getLprSyncMap() {
    try {
        const devices = await prisma.device.findMany({
            where: { deviceType: 'LPR_CAMERA' }
        });

        const syncMap: Record<string, string[]> = {};
        const driver = new HikvisionDriver();

        // Normalize helper
        const normalize = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

        await Promise.all(devices.map(async (device) => {
            if (device.brand === 'HIKVISION') {
                try {
                    // We use getPlatesPage with a large max or just getPlates if it exists
                    const plates = await driver.getPlates(device);
                    plates.forEach(p => {
                        const plate = normalize(p);
                        if (!plate) return;
                        if (!syncMap[plate]) syncMap[plate] = [];
                        if (!syncMap[plate].includes(device.name)) {
                            syncMap[plate].push(device.name);
                        }
                    });
                } catch (err) {
                    console.error(`Error fetching plates from ${device.name}:`, err);
                }
            }
        }));

        return syncMap;
    } catch (error) {
        console.error("Global Sync Map error:", error);
        return {};
    }
}

export async function importFaceBatch(id: string, faces: any[]) {
    try {
        const device = await prisma.device.findUnique({ where: { id } });
        if (!device) return { success: false, message: "Dispositivo no encontrado" };

        let importedCount = 0;
        let failedCount = 0;

        // Prefetch all users by DNI and name in batch to avoid N+1
        const faceIds = faces.map(f => f.UserID || f.ID).filter(Boolean);
        const faceNames = faces.map(f => f.Name).filter(n => n && n.length > 3);
        const [usersByDni, usersByName] = await Promise.all([
            prisma.user.findMany({ where: { dni: { in: faceIds } } }),
            faceNames.length > 0
                ? prisma.user.findMany({ where: { name: { in: faceNames, mode: 'insensitive' } } })
                : Promise.resolve([])
        ]);
        const dniMap = new Map(usersByDni.map(u => [u.dni, u]));
        const nameMap = new Map(usersByName.map(u => [u.name?.toLowerCase(), u]));

        for (const face of faces) {
            // face object is { UserID, Name, FaceUrl, ... }
            const userId = face.UserID || face.ID; // Usually employeeNo or ID
            const name = face.Name || `Usuario ${userId}`;

            if (!userId) continue;

            // Use prefetched maps instead of per-iteration queries
            let user = dniMap.get(userId) || null;

            // Fallback: Check by exact name match if ID didn't match and name is substantial
            if (!user && name && name.length > 3) {
                user = nameMap.get(name.toLowerCase()) || null;
            }

            if (!user) {
                try {
                    user = await prisma.user.create({
                        data: {
                            name: name,
                            dni: userId,
                            phone: "N/A",
                            role: 'RESIDENT',
                            cara: face.FaceUrl || null // Use URL if available
                        }
                    });
                    importedCount++;
                } catch (userError) {
                    console.error(`Error creating user for face ${name}`, userError);
                    failedCount++;
                    continue;
                }
            } else {
                // Update face URL if missing
                if (!user.cara && face.FaceUrl) {
                    await prisma.user.update({
                        where: { id: user.id },
                        data: { cara: face.FaceUrl }
                    });
                }
            }

            // Ensure Credential Exists
            if (user) {
                // Check if FACE credential exists
                const existingCred = await prisma.credential.findFirst({
                    where: {
                        userId: user.id,
                        type: 'FACE'
                    }
                });

                if (!existingCred) {
                    await prisma.credential.create({
                        data: {
                            type: 'FACE',
                            value: userId, // Store the ID as the credential value
                            userId: user.id,
                            notes: `Importado de ${device.name}`
                        }
                    });
                }
            }
        }

        revalidatePath("/admin/users");
        revalidatePath("/admin/credentials");
        revalidatePath("/admin/devices");

        return { success: true, count: importedCount, failed: failedCount };
    } catch (error: any) {
        console.error("[ImportFaceBatch] Error:", error);
        return { success: false, message: error.message };
    }
}

export async function syncPlatesToAllDevices() {
    try {
        // Get all LPR devices
        const devices = await prisma.device.findMany({
            where: {
                deviceType: "LPR_CAMERA",
                brand: "HIKVISION"
            }
        });

        if (devices.length === 0) {
            return { success: false, message: "No hay dispositivos LPR compatibles" };
        }

        // Get all plates from database
        const plates = await prisma.credential.findMany({
            where: { type: "PLATE" },
            include: {
                user: {
                    select: {
                        name: true,
                        unit: {
                            select: {
                                name: true
                            }
                        }
                    }
                }
            }
        });

        const results = [];
        const driver = new HikvisionDriver();

        for (const device of devices) {
            try {
                // Get current plates from camera
                let currentPlates: any[] = [];
                try {
                    const cameraData = await driver.getPlatesFromCamera(device);
                    currentPlates = cameraData || [];
                } catch (err) {
                    console.warn(`Could not fetch current plates from ${device.name}:`, err);
                }

                // Clear camera list
                try {
                    await driver.clearWhiteList(device);
                } catch (wipeError) {
                    console.warn(`[SyncAll] Could not wipe ${device.name}:`, wipeError);
                }

                // Sync all plates
                let successCount = 0;
                let failCount = 0;

                for (const plate of plates) {
                    try {
                        await driver.upsertCredential(plate, device);
                        successCount++;
                    } catch (err) {
                        failCount++;
                        console.error(`[SyncAll] Failed to sync plate ${plate.value} to ${device.name}:`, err);
                    }
                }

                results.push({
                    deviceId: device.id,
                    deviceName: device.name,
                    deviceIp: device.ip,
                    success: true,
                    previousCount: currentPlates.length,
                    syncedCount: successCount,
                    failedCount: failCount,
                    totalPlates: plates.length
                });

            } catch (error: any) {
                results.push({
                    deviceId: device.id,
                    deviceName: device.name,
                    deviceIp: device.ip,
                    success: false,
                    error: error.message
                });
            }
        }

        revalidatePath("/admin/devices");
        revalidatePath("/admin/users");

        return {
            success: true,
            totalDevices: devices.length,
            totalPlates: plates.length,
            results
        };

    } catch (error: any) {
        console.error("[SyncAll] Error:", error);
        return { success: false, message: error.message };
    }
}

export async function getFaceDevices() {
    try {
        const devices = await prisma.device.findMany({
            where: {
                OR: [
                    { deviceType: 'FACE_TERMINAL' },
                    { deviceType: 'LPR_CAMERA' }
                ]
            }
        });
        return devices;
    } catch (error) {
        console.error("Error fetching face devices:", error);
        return [];
    }
}

export async function updateDevicePosition(id: string, x: number, y: number, floorPlanId?: string) {
    try {
        await prisma.device.update({
            where: { id },
            data: {
                mapX: x,
                mapY: y,
                floorPlanId: floorPlanId || undefined
            }
        });
        revalidatePath("/admin/dashboard-face");
        return { success: true };
    } catch (error) {
        console.error("Error updating device position:", error);
        return { success: false };
    }
}

export async function deleteDevicePosition(id: string) {
    try {
        await prisma.device.update({
            where: { id },
            data: {
                mapX: null,
                mapY: null,
                floorPlanId: null
            }
        });
        revalidatePath("/admin/dashboard-face");
        return { success: true };
    } catch (error) {
        console.error("Error deleting device position:", error);
        return { success: false };
    }
}

export async function getAvailableStreams(): Promise<string[]> {
    try {
        const base = process.env.GO2RTC_API || "http://127.0.0.1:1984";
        const res = await fetch(`${base}/api/streams`, { cache: "no-store" });
        if (!res.ok) return [];
        const data = await res.json();
        return data && typeof data === "object" ? Object.keys(data) : [];
    } catch {
        return [];
    }
}
