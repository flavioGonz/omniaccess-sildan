"use server";

import { prisma } from "@/lib/prisma";
import { AkuvoxDriver } from "@/lib/drivers/AkuvoxDriver";

import { HikvisionDriver } from "@/lib/drivers/HikvisionDriver";
import { uploadToS3 } from "@/lib/s3";

export async function getDeviceFaces(deviceId: string) {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new Error("Device not found");

    let items: any[] = [];
    if (device.brand === 'AKUVOX') {
        const driver = new AkuvoxDriver();
        items = await driver.getFaceList(device);
    } else if (device.brand === 'HIKVISION') {
        const driver = new HikvisionDriver();

        // If it's explicitly an ANPR camera, try plates first
        if (device.deviceType === 'LPR_CAMERA') {
            const plates = await driver.getPlates(device);
            items = plates.map((plateNumber: string, index: number) => ({
                ID: plateNumber,
                UserID: `HIK-LPR-${index}`,
                Name: `Placa ${plateNumber}`,
                CardCode: plateNumber,
                HasFace: false,
                HasTag: true,
                IsPlate: true
            }));
        } else {
            // Default to Face Search for everything else (Terminals, Face Cams, IPCs)
            const faces = await driver.getFacesFromCamera(device);
            items = faces.map((f: any, index: number) => ({
                ID: f.employeeNo || f.FPID || f.faceURL || f.ID || `HIKFACE-${index}`,
                UserID: f.employeeNo || f.FPID || f.ID || f.UserID || f.name || "Desconocido",
                Name: f.name || f.Name || `Rostro ${index + 1}`,
                CardCode: f.CardNo || f.cardNo || f.card || "",
                HasFace: !!(f.faceURL || (f.faceLibType && f.faceLibType !== 'null') || f.FPID || f.faceId || f.faceData),
                HasTag: !!(f.CardNo || f.cardNo),
                IsPlate: false,
                FaceUrl: f.faceURL || ""
            }));

            // Fallback to LPR search if NO faces found and it's not explicitly a terminal
            if (items.length === 0 && device.deviceType !== 'FACE_TERMINAL') {
                const plates = await driver.getPlates(device);
                items = plates.map((plateNumber: string, index: number) => ({
                    ID: plateNumber,
                    UserID: `HIK-LPR-${index}`,
                    Name: `Placa ${plateNumber}`,
                    CardCode: plateNumber,
                    HasFace: false,
                    HasTag: true,
                    IsPlate: true
                }));
            }
        }
    }

    // Mirroring: Update HardwareMirror table to have a "cached" version of hardware memory
    const mirroredItems = [];
    if (items.length > 0) {
        try {
            for (const item of items) {
                const mirror = await prisma.hardwareMirror.upsert({
                    where: { deviceId_hardwareId: { deviceId: device.id, hardwareId: String(item.ID) } },
                    update: {
                        name: item.Name,
                        cardCode: item.CardCode,
                        pin: item.PIN || null,
                        faceUrl: item.FaceUrl,
                        lastUpdated: new Date()
                    },
                    create: {
                        deviceId: device.id,
                        hardwareId: String(item.ID),
                        name: item.Name,
                        cardCode: item.CardCode,
                        pin: item.PIN || null,
                        faceUrl: item.FaceUrl,
                        syncStatus: "ONLY_HARDWARE"
                    }
                });
                mirroredItems.push({ ...item, SyncStatus: mirror.syncStatus });
            }
            return mirroredItems;
        } catch (e) {
            console.error("[Mirror] Failed to update HardwareMirror:", e);
            return items.map(i => ({ ...i, SyncStatus: 'UNKNOWN' }));
        }
    }

    return items;
}

export async function getDatabaseStats() {
    const totalUsers = await prisma.user.count();
    const totalTags = await prisma.credential.count({ where: { type: 'TAG' } });
    const totalPlates = await prisma.credential.count({ where: { type: 'PLATE' } });
    return { users: totalUsers, tags: totalTags, plates: totalPlates };
}

export async function deleteDeviceFace(deviceId: string, faceId: string, userId?: string, userCode?: string) {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new Error("Device not found");

    if (device.brand === 'AKUVOX') {
        const driver = new AkuvoxDriver();
        return await driver.deleteFace(device, faceId, userId, userCode);
    }

    if (device.brand === 'HIKVISION') {
        const driver = new HikvisionDriver();
        await driver.deleteCredential(faceId, device);
        return true;
    }

    return false;
}

export async function syncUserToDevice(deviceId: string, userId: string) {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { credentials: true }
    });

    if (!device || !user) throw new Error("Device or User not found");

    if (device.brand === 'AKUVOX') {
        const driver = new AkuvoxDriver();
        // Check if user has a face photo (cara) OR a Face credential
        const hasFace = user.cara && user.cara.length > 0;

        // Sync user regardless of face (handles PIN/Tag too)
        await driver.syncUserWithFace(user, device);
        return true;
    }

    if (device.brand === 'HIKVISION') {
        const driver = new HikvisionDriver();

        if (device.deviceType === 'FACE_TERMINAL' || device.deviceType === 'ACCESS_CONTROL') {
            await driver.syncUserWithFace(user, device);
            return true;
        } else {
            // LPR Path
            const plate = user.credentials.find(c => c.type === 'PLATE');
            if (plate) {
                await driver.upsertCredential(plate, device);
                return true;
            }
        }
    }
    return false;
}

export async function syncIdentityAction(deviceId: string, item: any, unitId?: string) {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new Error("Device not found");

    const importDate = new Date().toLocaleString();
    const comment = `Importado de [${device.name}] el ${importDate}`;

    // Find existing user or create one
    let user = await prisma.user.findFirst({
        where: { name: item.Name }
    });

    if (!user) {
        user = await prisma.user.create({
            data: {
                name: item.Name,
                phone: "N/A",
                dni: String(item.UserID || ""),
                unitId: unitId || null,
                cara: item.FaceUrl || null
            }
        });
    }

    if (item.HasTag) {
        const hasTag = await prisma.credential.findFirst({
            where: { userId: user.id, type: 'TAG', value: item.CardCode }
        });

        if (!hasTag) {
            await prisma.credential.create({
                data: {
                    userId: user.id,
                    type: item.IsPlate ? 'PLATE' : 'TAG',
                    value: item.CardCode,
                    notes: comment
                }
            });
        }
    }

    // Handle Face Image Download
    if (item.HasFace && (device.brand === 'AKUVOX' || device.brand === 'HIKVISION')) {
        try {
            const driver = device.brand === 'AKUVOX' ? new AkuvoxDriver() : new HikvisionDriver();
            const imageBuffer = await driver.getFaceImage(device, item.ID);

            if (imageBuffer) {
                const fileName = `import_${item.ID}_${Date.now()}.jpg`;
                const fileUrl = await uploadToS3(imageBuffer, fileName, "image/jpeg", "face");

                await prisma.user.update({
                    where: { id: user.id },
                    data: { cara: fileUrl }
                });
            }
        } catch (e) {
            console.error(`[Import] Failed to save face image for ${item.Name}:`, e);
        }
    }

    // Update Mirror Status
    await prisma.hardwareMirror.update({
        where: { deviceId_hardwareId: { deviceId: device.id, hardwareId: String(item.ID) } },
        data: { syncStatus: "IN_SYNC" }
    });

    return {
        success: true,
        userId: user.id,
        name: user.name,
        hasTag: item.HasTag,
        hasFace: item.HasFace
    };
}

export async function exportAllToDevice(deviceId: string) {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new Error("Device not found");

    // Get all users with credentials or face
    const users = await prisma.user.findMany({
        include: { credentials: true }
    });

    let processed = 0;
    let faces = 0;
    let tags = 0;

    if (device.brand === 'AKUVOX') {
        const driver = new AkuvoxDriver();
        for (const user of users) {
            // Sincronizar usuario completo (Nombre + TAGs + PIN + Cara)
            const hasFace = user.cara && user.cara.length > 0;
            const hasTags = user.credentials.some(c => c.type === 'TAG');

            if (hasFace || hasTags) {
                await driver.syncUserWithFace(user, device);
                if (hasFace) faces++;
                if (hasTags) tags += user.credentials.filter(c => c.type === 'TAG').length;
                processed++;
            }
        }
    }

    if (device.brand === 'HIKVISION') {
        const driver = new HikvisionDriver();
        for (const user of users) {
            if (device.deviceType === 'FACE_TERMINAL') {
                const hasFace = user.cara && user.cara.length > 0;
                const hasTags = user.credentials.some(c => c.type === 'TAG');

                if (hasFace || hasTags) {
                    await driver.syncUserWithFace(user, device);
                    if (hasFace) faces++;
                    if (hasTags) tags += user.credentials.filter(c => c.type === 'TAG').length;
                }
            } else {
                const plates = user.credentials.filter(c => c.type === 'PLATE');
                for (const plate of plates) {
                    await driver.upsertCredential(plate, device);
                    tags++;
                }
            }
            processed++;
        }
    }

    return { processed, faces, tags };
}

export async function importAllFromDevice(deviceId: string) {
    // Only kept for legacy reference or bulk call if needed without UI progress
    const items = await getDeviceFaces(deviceId);
    const results = [];
    for (const item of items) {
        results.push(await syncIdentityAction(deviceId, item));
    }
    return results;
}

export async function getDeviceDoorlogs(deviceId: string, limit: number = 50, offset: number = 0) {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new Error("Device not found");

    if (device.brand === 'AKUVOX') {
        const driver = new AkuvoxDriver();
        return await driver.getDoorlog(device, limit, offset);
    } else if (device.brand === 'HIKVISION') {
        const driver = new HikvisionDriver();
        return await driver.getDoorlog(device, limit, offset);
    }

    return [];
}

export async function getDeviceCalllogs(deviceId: string, limit: number = 50, offset: number = 0) {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new Error("Device not found");

    if (device.brand === 'AKUVOX') {
        const driver = new AkuvoxDriver();
        return await driver.getCalllog(device, limit, offset);
    }

    return [];
}

export async function syncHardwareLogs(deviceId: string) {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new Error("Device not found");

    if (device.brand === 'AKUVOX') {
        const driver = new AkuvoxDriver();
        const logs = await driver.getDoorlog(device, 100); // Fetch last 100

        let created = 0;

        // Prefetch: get all existing events for this device in the time range to avoid N+1
        const logTimestamps = logs
            .map((l: any) => new Date(l.Time))
            .filter((d: Date) => !isNaN(d.getTime()));
        const minTime = logTimestamps.length > 0
            ? new Date(Math.min(...logTimestamps.map((d: Date) => d.getTime())) - 2000)
            : new Date();
        const maxTime = logTimestamps.length > 0
            ? new Date(Math.max(...logTimestamps.map((d: Date) => d.getTime())) + 2000)
            : new Date();

        const existingEvents = await prisma.accessEvent.findMany({
            where: {
                deviceId: device.id,
                timestamp: { gte: minTime, lte: maxTime }
            },
            select: { timestamp: true }
        });
        const existingTimestamps = existingEvents.map(e => e.timestamp.getTime());

        // Prefetch users by names and card credentials
        const logNames = logs.map((l: any) => l.Name).filter(Boolean);
        const logCards = logs.map((l: any) => l.Card).filter(Boolean);
        const [usersByName, usersByCard] = await Promise.all([
            logNames.length > 0
                ? prisma.user.findMany({ where: { name: { in: logNames } } })
                : Promise.resolve([]),
            logCards.length > 0
                ? prisma.user.findMany({
                    where: { credentials: { some: { value: { in: logCards } } } }
                })
                : Promise.resolve([])
        ]);
        const nameUserMap = new Map(usersByName.map(u => [u.name, u]));
        const cardUserMap = new Map<string, any>();
        // For card lookup we need credential->user mapping
        if (logCards.length > 0) {
            const cardCreds = await prisma.credential.findMany({
                where: { value: { in: logCards } },
                include: { user: true }
            });
            for (const cred of cardCreds) {
                cardUserMap.set(cred.value, cred.user);
            }
        }

        for (const log of logs) {
            const timestamp = new Date(log.Time);
            if (isNaN(timestamp.getTime())) continue;

            // Check if exists using prefetched data (2-second window)
            const ts = timestamp.getTime();
            const existing = existingTimestamps.some(et => Math.abs(et - ts) <= 2000);

            if (!existing) {
                // Use prefetched user maps
                const user = nameUserMap.get(log.Name) || cardUserMap.get(log.Card) || null;

                await prisma.accessEvent.create({
                    data: {
                        timestamp: timestamp,
                        deviceId: device.id,
                        userId: user?.id,
                        decision: log.Status === "0" || log.Status === 0 ? "GRANT" : "DENY",
                        details: `SINCRO_HW: ${log.Mode || log.Event || "Acceso"}`,
                        plateDetected: log.Name || "Desconocido",
                        direction: device.direction,
                        location: device.location,
                        imagePath: (log.PicUrl || log.PicPath || log.pic_url || log.snap_path || log.PicName)
                            ? `/api/proxy/device-image?deviceId=${device.id}&path=${encodeURIComponent(log.PicUrl || log.PicPath || log.pic_url || log.snap_path || log.PicName)}`
                            : null,
                    }
                });
                created++;
            }
        }
        return { success: true, count: created };
    }

    return { success: false, message: "Marca no compatible para sincronización de memoria" };
}

export async function getSyncedEvents(take: number = 50) {
    return await prisma.accessEvent.findMany({
        where: {
            OR: [
                { details: { contains: "SINCRO_HW" } },
                { details: { contains: "Sincro Hardware", mode: 'insensitive' } }
            ]
        },
        take,
        orderBy: { timestamp: "desc" },
        include: {
            user: {
                select: {
                    name: true,
                    unit: { select: { name: true } }
                }
            },
            device: true
        }
    });
}

export async function getDeviceAccessEvents(deviceId: string, take: number = 100) {
    return await prisma.accessEvent.findMany({
        where: { deviceId },
        take,
        orderBy: { timestamp: "desc" },
        include: {
            user: {
                select: {
                    name: true,
                    unit: { select: { name: true } }
                }
            },
            device: true
        }
    });
}

export async function previewHardwareLogs(deviceId: string) {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new Error("Device not found");

    if (device.brand === 'AKUVOX') {
        const driver = new AkuvoxDriver();
        const logs = await driver.getDoorlog(device, 50); // Preview last 50

        const preview = [];
        for (const log of logs) {
            const timestamp = new Date(log.Time);
            if (isNaN(timestamp.getTime())) continue;

            const startTime = new Date(timestamp.getTime() - 2000);
            const endTime = new Date(timestamp.getTime() + 2000);

            const existing = await prisma.accessEvent.findFirst({
                where: {
                    deviceId: device.id,
                    timestamp: { gte: startTime, lte: endTime }
                }
            });

            preview.push({
                ...log,
                exists: !!existing,
                timestamp: timestamp
            });
        }
        return preview;
    }

    return [];
}

export async function previewHardwareCallLogs(deviceId: string) {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new Error("Device not found");

    if (device.brand === 'AKUVOX') {
        const driver = new AkuvoxDriver();
        const logs = await driver.getCalllog(device, 50);

        const preview = [];
        for (const log of logs) {
            const timestamp = new Date(log.Time);
            if (isNaN(timestamp.getTime())) continue;

            const startTime = new Date(timestamp.getTime() - 2000);
            const endTime = new Date(timestamp.getTime() + 2000);

            const existing = await prisma.accessEvent.findFirst({
                where: {
                    deviceId: device.id,
                    timestamp: { gte: startTime, lte: endTime },
                    details: { contains: 'Llamada' }
                }
            });

            preview.push({
                ...log,
                exists: !!existing,
                timestamp: timestamp
            });
        }
        return preview;
    }
    return [];
}

export async function syncHardwareCallLogs(deviceId: string) {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new Error("Device not found");

    if (device.brand === 'AKUVOX') {
        const driver = new AkuvoxDriver();
        const logs = await driver.getCalllog(device, 100);

        let created = 0;
        for (const log of logs) {
            const timestamp = new Date(log.Time);
            if (isNaN(timestamp.getTime())) continue;

            const startTime = new Date(timestamp.getTime() - 2000);
            const endTime = new Date(timestamp.getTime() + 2000);

            const existing = await prisma.callEvent.findFirst({
                where: {
                    deviceId: device.id,
                    timestamp: { gte: startTime, lte: endTime }
                }
            });

            if (!existing) {
                await prisma.callEvent.create({
                    data: {
                        timestamp: timestamp,
                        deviceId: device.id,
                        callerName: log.Name || null,
                        callerId: log.CallerID || null,
                        calleeId: log.CalleeID || null,
                        duration: parseInt(log.TalkTime || "0"),
                        status: log.Status === "1" ? "SUCCESS" : "MISSED",
                        direction: log.Type === "0" ? "INCOMING" : "OUTGOING"
                    }
                });
                created++;
            }
        }
        return { success: true, count: created };
    }
    return { success: false, message: "No compatible" };
}
