"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { UserRole } from "@prisma/client";
import { addDevicePlate } from "./devices";
import fs from "fs/promises";
import path from "path";
import { uploadToS3 } from "@/lib/s3";

export async function getUsers(options?: { take?: number, skip?: number }) {
    const users = await prisma.user.findMany({
        include: {
            unit: true,
            credentials: true,
            accessGroups: {
                include: {
                    devices: true
                }
            },
            vehicles: true,
            parkingSlot: true,
        },
        orderBy: {
            createdAt: 'desc'
        },
        take: options?.take,
        skip: options?.skip
    });
    return users;
}

export async function getUsersCount() {
    return await prisma.user.count();
}

export async function getGuardsList() {
    const guards = await prisma.user.findMany({
        where: {
            role: { in: ['STAFF', 'ADMIN'] }
        },
        include: {
            credentials: true
        },
        orderBy: { name: 'asc' }
    });

    // R5: NO exponer secretos al cliente — se quitan credenciales y password.
    return guards.map(({ credentials, ...g }) => g);
}

// R5: verificación de PIN/contraseña del guardia en el SERVIDOR (los secretos nunca salen).
export async function verifyGuardCredential(identifier: string, secret: string): Promise<{ ok: boolean; name?: string; cara?: string | null }> {
    if (!identifier || !secret) return { ok: false };
    const id = identifier.trim().toLowerCase();
    const guards = await prisma.user.findMany({
        where: { role: { in: ['STAFF', 'ADMIN'] } },
        include: { credentials: true },
    });
    const guard = guards.find((g) => ((g.username || '').toLowerCase() === id) || ((g.name || '').toLowerCase() === id));
    if (!guard) return { ok: false };
    const secretVal = guard.credentials.find((c) => c.type === 'PASSWORD')?.value || guard.credentials.find((c) => c.type === 'PIN')?.value || '';
    return secretVal && secretVal === secret ? { ok: true, name: guard.name, cara: guard.cara } : { ok: false };
}

export async function getAdminsList() {
    const admins = await prisma.user.findMany({
        where: {
            role: { in: ['ADMIN', 'OPERATOR'] }
        },
        include: {
            credentials: true
        },
        orderBy: { name: 'asc' }
    });

    return admins.map(a => ({
        ...a,
        username: a.name, // Mapping name to username for UI consistency
        password: a.credentials.find(c => c.type === 'PASSWORD')?.value || ''
    }));
}

export async function saveGuard(formData: FormData) {
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const username = formData.get("username") as string;
    const dni = formData.get("dni") as string;
    const password = formData.get("password") as string;
    const photoFile = formData.get("photo") as File | null;
    const currentPhoto = formData.get("currentPhoto") as string;

    let photoPath = currentPhoto;

    // Handle File Upload
    if (photoFile && photoFile.size > 0) {
        try {
            const bytes = await photoFile.arrayBuffer();
            const buffer = Buffer.from(bytes);
            const fileName = `guard-${Date.now()}-${photoFile.name.replace(/[^a-zA-Z0-9.]/g, "_")}`;

            // Upload to S3 (Face bucket)
            photoPath = await uploadToS3(buffer, fileName, photoFile.type || "image/jpeg", "face");
        } catch (error) {
            console.error("Error uploading guard photo:", error);
            throw new Error("Error al subir la foto");
        }
    }

    const data: any = {
        name,
        username: username || name.toLowerCase().replace(/\s+/g, '.'),
        dni,
        cara: photoPath || null
    };

    let user;
    if (id) {
        // When updating by ID (from Admin UI), we can set the role
        data.role = 'STAFF';
        user = await prisma.user.update({
            where: { id },
            data
        });
    } else {
        // Find existing user by name to avoid duplicates
        const existingUser = await prisma.user.findFirst({
            where: { name }
        });

        if (existingUser) {
            // Preserve ADMIN role if it exists
            if (existingUser.role !== 'ADMIN') {
                data.role = 'STAFF';
            }
            user = await prisma.user.update({
                where: { id: existingUser.id },
                data
            });
        } else {
            data.role = 'STAFF';
            user = await prisma.user.create({
                data
            });
        }
    }

    // Handle Password (PASSWORD Type)
    if (password) {
        // Update or Create PASSWORD credential
        const existingPass = await prisma.credential.findFirst({
            where: { userId: user.id, type: 'PASSWORD' }
        });

        if (existingPass) {
            await prisma.credential.update({
                where: { id: existingPass.id },
                data: { value: password }
            });
        } else {
            await prisma.credential.create({
                data: {
                    userId: user.id,
                    type: 'PASSWORD',
                    value: password
                }
            });
        }

        // Also update PIN for backward compatibility if needed, or if the UI uses it as PIN too
        const existingPin = await prisma.credential.findFirst({
            where: { userId: user.id, type: 'PIN' }
        });

        if (existingPin) {
            await prisma.credential.update({
                where: { id: existingPin.id },
                data: { value: password }
            });
        } else {
            await prisma.credential.create({
                data: {
                    userId: user.id,
                    type: 'PIN',
                    value: password
                }
            });
        }
    }

    revalidatePath("/admin/consolas");
    return user;
}

export async function saveAdmin(formData: FormData) {
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const photoFile = formData.get("photo") as File | null;
    const currentPhoto = formData.get("currentPhoto") as string;

    let photoPath = currentPhoto;

    // Handle File Upload
    if (photoFile && photoFile.size > 0) {
        try {
            const bytes = await photoFile.arrayBuffer();
            const buffer = Buffer.from(bytes);
            const fileName = `admin-${Date.now()}-${photoFile.name.replace(/[^a-zA-Z0-9.]/g, "_")}`;

            // Upload to S3 (Face bucket)
            photoPath = await uploadToS3(buffer, fileName, photoFile.type || "image/jpeg", "face");
        } catch (error) {
            console.error("Error uploading admin photo:", error);
            throw new Error("Error al subir la foto");
        }
    }

    const rolRaw = (formData.get("role") as string) || "ADMIN";
    const rol = (rolRaw === "ADMIN" || rolRaw === "OPERATOR") ? rolRaw : "ADMIN";
    const data: any = {
        name, // Username
        email: email || null,
        role: rol,
        cara: photoPath || null
    };

    let user;
    if (id) {
        user = await prisma.user.update({
            where: { id },
            data
        });
    } else {
        // Check uniqueness of name (username)
        const existing = await prisma.user.findFirst({ where: { name } });
        if (existing) throw new Error("El nombre de usuario ya existe");

        user = await prisma.user.create({
            data
        });
    }

    // Handle Password
    if (password) {
        // Delete existing password creds
        await prisma.credential.deleteMany({
            where: { userId: user.id, type: 'PASSWORD' }
        });

        await prisma.credential.create({
            data: {
                userId: user.id,
                type: 'PASSWORD',
                value: password
            }
        });
    }

    revalidatePath("/admin/settings");
    return user;
}

export async function deleteAdmin(id: string) {
    // Prevent deleting self? UI handles it usually, or middleware.
    await prisma.user.delete({ where: { id } });
    revalidatePath("/admin/settings");
}

export async function deleteGuard(id: string) {
    await prisma.user.delete({ where: { id } });
    revalidatePath("/admin/consolas");
}

export async function deleteUser(id: string) {
    await prisma.user.delete({
        where: { id },
    });
    revalidatePath("/admin/users");
}

export async function getQuickCreateData() {
    const [units, groups, devices, parkingSlots] = await Promise.all([
        prisma.unit.findMany({ orderBy: { name: 'asc' } }),
        prisma.accessGroup.findMany({ include: { devices: true }, orderBy: { name: 'asc' } }),
        prisma.device.findMany({ orderBy: { name: 'asc' } }),
        prisma.parkingSlot.findMany({ include: { user: true }, orderBy: { label: 'asc' } })
    ]);
    return { units, groups, devices, parkingSlots };
}

export async function createUser(formData: FormData) {
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const phone = formData.get("phone") as string;
    const role = formData.get("role") as UserRole;
    const unitId = formData.get("unitId") as string;
    const cara = formData.get("cara") as string; // Optional snapshot path

    // Optional fields
    const plate = formData.get("plate") as string;
    const accessTags = formData.get("accessTags") as string;
    const pin = formData.get("pin") as string;

    const apartment = formData.get("apartment") as string;
    const parkingSlotId = formData.get("parkingSlotId") as string;


    const userPayload: any = {
        name,
        email,
        phone: phone || null,
        role,
        cara: cara || null,
        apartment: apartment || null,
        parkingSlotId: (parkingSlotId && parkingSlotId !== "none") ? parkingSlotId : null,
    };

    if (unitId && unitId !== "none") {
        userPayload.unitId = unitId;
    }

    const newUser = await prisma.user.create({
        data: userPayload,
    });

    // Handle Vehicle/Plate creation if provided
    if (plate && plate.trim() !== "") {
        await prisma.vehicle.create({
            data: {
                plate: plate.toUpperCase().trim(),
                type: 'SEDAN', // Default type, can be enhanced later
                userId: newUser.id
            }
        });

        // Also add as explicit PLATE credential
        await prisma.credential.create({
            data: {
                type: 'PLATE',
                value: plate.toUpperCase().trim(),
                userId: newUser.id
            }
        });
    }

    // Handle Access Tags (RFID) creation
    if (accessTags && accessTags.trim() !== "") {
        const tags = accessTags.split(',').map(t => t.trim()).filter(t => t !== "");
        if (tags.length > 0) {
            await prisma.credential.createMany({
                data: tags.map(tag => ({
                    type: 'TAG',
                    value: tag,
                    userId: newUser.id
                }))
            });
        }
    }

    // Handle PIN creation if provided
    if (pin && pin.trim() !== "") {
        await prisma.credential.create({
            data: {
                type: 'PIN',
                value: pin.trim(),
                userId: newUser.id
            }
        });
    }

    // Handle Groups (if strictly needed from form, but usually handled separately or default)
    // For now we assume groups are managed via edit or default logic if any

    revalidatePath("/admin/users");
    return newUser;
}

export async function updateUser(id: string, formData: FormData) {
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const phone = formData.get("phone") as string;
    const role = formData.get("role") as UserRole;
    const unitId = formData.get("unitId") as string;

    const plate = formData.get("plate") as string;
    const accessTags = formData.get("accessTags") as string;
    const pin = formData.get("pin") as string;

    const apartment = formData.get("apartment") as string;
    const parkingSlotId = formData.get("parkingSlotId") as string;


    const userPayload: any = {
        name,
        email,
        phone: phone || null,
        role,
        apartment: apartment || null,
        parkingSlotId: (parkingSlotId && parkingSlotId !== "none") ? parkingSlotId : null,
    };

    if (unitId && unitId !== "none") {
        userPayload.unitId = unitId;
    } else {
        userPayload.unitId = null;
    }

    const updatedUser = await prisma.user.update({
        where: { id },
        data: userPayload,
    });

    // Update or Create Vehicle/Plate
    if (plate !== null) {
        const existingVehicle = await prisma.vehicle.findFirst({
            where: { userId: id }
        });

        if (plate.trim() === "") {
            if (existingVehicle) {
                await prisma.vehicle.delete({ where: { id: existingVehicle.id } });
            }
            await prisma.credential.deleteMany({
                where: { userId: id, type: 'PLATE' }
            });
        } else {
            if (existingVehicle) {
                await prisma.vehicle.update({
                    where: { id: existingVehicle.id },
                    data: { plate: plate.toUpperCase().trim() }
                });
            } else {
                await prisma.vehicle.create({
                    data: {
                        plate: plate.toUpperCase().trim(),
                        type: 'SEDAN',
                        userId: id
                    }
                });
            }
            const existingCred = await prisma.credential.findFirst({
                where: { userId: id, type: 'PLATE' }
            });
            if (existingCred) {
                await prisma.credential.update({
                    where: { id: existingCred.id },
                    data: { value: plate.toUpperCase().trim() }
                });
            } else {
                await prisma.credential.create({
                    data: {
                        type: 'PLATE',
                        value: plate.toUpperCase().trim(),
                        userId: id
                    }
                });
            }
        }
    }

    // Update or Create Access Tags (RFID)
    if (accessTags !== null) {
        // We replace all tags to ensure sync with the list provided in the form

        // 1. Delete existing TAGs for this user
        await prisma.credential.deleteMany({
            where: { userId: id, type: 'TAG' }
        });

        // 2. Create new tags from the list
        if (accessTags.trim() !== "") {
            const tags = accessTags.split(',').map(t => t.trim()).filter(t => t !== "");
            if (tags.length > 0) {
                await prisma.credential.createMany({
                    data: tags.map(tag => ({
                        type: 'TAG',
                        value: tag,
                        userId: id
                    }))
                });
            }
        }
    }

    // Update or Create PIN
    if (pin !== null) {
        const existingPin = await prisma.credential.findFirst({
            where: { userId: id, type: 'PIN' }
        });

        if (pin.trim() === "") {
            if (existingPin) {
                await prisma.credential.delete({ where: { id: existingPin.id } });
            }
        } else {
            if (existingPin) {
                await prisma.credential.update({
                    where: { id: existingPin.id },
                    data: { value: pin.trim() }
                });
            } else {
                await prisma.credential.create({
                    data: {
                        type: 'PIN',
                        value: pin.trim(),
                        userId: id
                    }
                });
            }
        }
    }

    revalidatePath("/admin/users");
    return updatedUser;
}

export async function deleteAllUsers() {
    try {
        await prisma.user.deleteMany({});
        revalidatePath('/admin/users');
        return true;
    } catch (error) {
        console.error("Failed to delete all users:", error);
        throw new Error("Failed to delete all users");
    }
}

export async function importUserBatch(users: any[]) {
    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    for (const u of users) {
        try {
            // Normalize DNI
            if (!u.Name || !u.DNI) {
                failCount++;
                errors.push(`Fila inválida: Falta Nombre o DNI`);
                continue;
            }

            // Find or Upsert Unit
            let unitId = null;
            if (u.Unidad) {
                const unitName = u.Unidad.toString().trim();
                const unit = await prisma.unit.findFirst({
                    where: { name: { equals: unitName, mode: 'insensitive' } }
                });
                if (unit) unitId = unit.id;
            }

            // Upsert User
            // Look for existing user by DNI
            let user = await prisma.user.findFirst({
                where: { dni: u.DNI.toString() }
            });

            if (user && user.role === 'ADMIN') {
                // Skip overwriting admins via batch import to protect system integrity
                successCount++;
                continue;
            }

            const userData = {
                name: u.Name,
                dni: u.DNI.toString(),
                email: u.Email || null,
                phone: u.Phone ? u.Phone.toString() : null,
                role: (['RESIDENT', 'VISITOR', 'STAFF', 'ADMIN', 'PROVIDER'].includes(u.Role) ? u.Role : 'RESIDENT') as UserRole,
                unitId: unitId,
                cara: u.FaceURL || null,
            };

            if (user) {
                user = await prisma.user.update({
                    where: { id: user.id },
                    data: userData
                });
            } else {
                user = await prisma.user.create({
                    data: userData
                });
            }

            // Handle Credentials

            // 1. Tags
            if (u.Tags) {
                const tags = u.Tags.toString().split(',').map((t: string) => t.trim()).filter((t: string) => t);
                for (const tag of tags) {
                    const exists = await prisma.credential.findFirst({
                        where: { type: 'TAG', value: tag, userId: user.id }
                    });
                    if (!exists) {
                        const existsGlobal = await prisma.credential.findFirst({ where: { type: 'TAG', value: tag } });
                        if (!existsGlobal) {
                            await prisma.credential.create({
                                data: { type: 'TAG', value: tag, userId: user.id, notes: 'Importado Excel' }
                            });
                        }
                    }
                }
            }

            // 2. Plates
            if (u.Plates) {
                const plates = u.Plates.toString().split(',').map((p: string) => p.trim().toUpperCase()).filter((p: string) => p);
                for (const plate of plates) {
                    // Ensure Vehicle
                    const existsVehicle = await prisma.vehicle.findUnique({ where: { plate } });
                    if (!existsVehicle) {
                        await prisma.vehicle.create({
                            data: { plate, userId: user.id, type: 'SEDAN', brand: "Importado" }
                        });
                    }

                    // Ensure Credential
                    const existsCred = await prisma.credential.findFirst({ where: { type: 'PLATE', value: plate } });
                    if (!existsCred) {
                        await prisma.credential.create({
                            data: { type: 'PLATE', value: plate, userId: user.id, notes: 'Importado Excel' }
                        });
                    }
                }
            }

            // 3. Face (if processed from upload as credential)
            if (u.FaceURL || (u.HasFace === 'YES')) {
                const existsFace = await prisma.credential.findFirst({
                    where: { type: 'FACE', userId: user.id }
                });
                if (!existsFace) {
                    await prisma.credential.create({
                        data: { type: 'FACE', value: user.dni || user.id, userId: user.id, notes: 'Importado Excel (Auto)' }
                    });
                }
            }

            successCount++;

        } catch (e: any) {
            console.error(e);
            failCount++;
            errors.push(`Error en fila de ${u.Name || 'Desconocido'}: ${e.message}`);
        }
    }

    revalidatePath("/admin/users");
    return { success: true, count: successCount, failed: failCount, errors };
}

export async function getBlacklist() {
    return await prisma.user.findMany({
        where: { role: 'BLACKLISTED' },
        include: {
            unit: true,
            credentials: true,
            accessEvents: {
                take: 10,
                orderBy: { timestamp: 'desc' },
                include: { device: true }
            }
        },
        orderBy: { updatedAt: 'desc' }
    });
}

export async function getWhitelist() {
    return await prisma.user.findMany({
        where: { role: 'WHITELISTED' },
        include: {
            unit: true,
            credentials: true,
            accessEvents: {
                take: 5,
                orderBy: { timestamp: 'desc' },
                include: { device: true }
            }
        },
        orderBy: { updatedAt: 'desc' }
    });
}

export async function toggleBlacklist(userId: string, isBlacklisted: boolean, reason?: string, creator?: string) {
    // If we are un-blacklisting, check if we should go to WHITELISTED or just VISITOR
    // For now, if called with isBlacklisted=false, we move to WHITELISTED by default if it was initiated from dashboard as "Promover"

    // Actually, let's look at the current role first
    const currentUser = await prisma.user.findUnique({ where: { id: userId } });

    let newRole: UserRole = isBlacklisted ? 'BLACKLISTED' : 'WHITELISTED';

    // If it was already STAFF or ADMIN, we shouldn't downgrade it to WHITELISTED/VISITOR unless specified
    if (!isBlacklisted && currentUser && ['STAFF', 'ADMIN', 'RESIDENT'].includes(currentUser.role)) {
        newRole = currentUser.role;
    }

    const user = await prisma.user.update({
        where: { id: userId },
        data: {
            role: newRole,
            blacklistReason: reason || null,
            createdBy: creator || null,
            updatedAt: new Date()
        }
    });
    revalidatePath("/admin/dashboard-face");
    revalidatePath("/admin/users");
    return user;
}
import { registerFaceInCompereFace } from "./face-verify";

export async function registerFace(formData: FormData) {
    const name = formData.get("name") as string;
    const dni = formData.get("dni") as string;
    const isBlacklisted = formData.get("isBlacklisted") === "true";
    const isWhitelisted = formData.get("isWhitelisted") === "true";
    const requestedRole = formData.get("role") as UserRole | null;
    const photoFile = formData.get("photo") as File;
    const reason = formData.get("reason") as string;
    const creator = formData.get("creator") as string;

    let photoPath = "";
    let photoBuffer: Buffer | null = null;

    if (photoFile && photoFile.size > 0) {
        photoBuffer = Buffer.from(await photoFile.arrayBuffer());
        const filename = `face-${Date.now()}-${name.replace(/\s+/g, '_')}.jpg`;
        photoPath = await uploadToS3(photoBuffer, filename, photoFile.type || "image/jpeg", "face");
    }

    const role = requestedRole || (isBlacklisted ? 'BLACKLISTED' : (isWhitelisted ? 'WHITELISTED' : 'VISITOR'));

    const user = await prisma.user.create({
        data: {
            name,
            dni,
            role,
            cara: photoPath || null,
            blacklistReason: reason || null,
            createdBy: creator || null
        }
    });

    // Mirror registration to CompereFace if photo exists
    if (photoBuffer) {
        try {
            await registerFaceInCompereFace(name, photoBuffer);
        } catch (err) {
            console.error("[Sync] Failed to register in CompereFace:", err);
            // We continue as the user is already in our DB
        }
    }

    if (photoPath) {
        await prisma.credential.create({
            data: {
                userId: user.id,
                type: 'FACE',
                value: dni || user.id,
                notes: isBlacklisted ? 'REGISTRO BLACKLIST' : 'REGISTRO SHOPPING'
            }
        } as any);
    }

    revalidatePath("/admin/dashboard-face");
    return user;
}
export async function searchUsers(query: string) {
    if (!query) return [];

    return await prisma.user.findMany({
        where: {
            OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { dni: { contains: query, mode: 'insensitive' } }
            ]
        },
        include: {
            unit: true
        },
        take: 10,
        orderBy: { updatedAt: 'desc' }
    });
}


export async function quickRegisterPlate(plate: string, name: string, unitName?: string) {
    "use server";
    
    if (!plate || !plate.trim()) {
        return { success: false, error: "Matrícula requerida" };
    }
    
    const normalizedPlate = plate.toUpperCase().trim();
    
    // Check if plate already exists
    const existing = await prisma.vehicle.findUnique({
        where: { plate: normalizedPlate },
        include: { user: true }
    });
    
    if (existing) {
        return { 
            success: false, 
            error: `La matrícula ${normalizedPlate} ya está registrada${existing.user ? ` (${existing.user.name})` : ""}` 
        };
    }
    
    // Find or create unit if provided
    let unitId: string | undefined;
    if (unitName && unitName.trim()) {
        const unit = await prisma.unit.findFirst({
            where: { name: { equals: unitName.trim(), mode: "insensitive" } }
        });
        if (unit) {
            unitId = unit.id;
        }
    }
    
    // Create user
    const user = await prisma.user.create({
        data: {
            name: name.trim() || `Propietario ${normalizedPlate}`,
            role: "RESIDENT",
            ...(unitId ? { unitId } : {}),
        }
    });
    
    // Create vehicle
    await prisma.vehicle.create({
        data: {
            plate: normalizedPlate,
            type: "SEDAN",
            userId: user.id
        }
    });
    
    // Create PLATE credential
    await prisma.credential.create({
        data: {
            type: "PLATE",
            value: normalizedPlate,
            userId: user.id
        }
    });
    
    return { 
        success: true, 
        user: { id: user.id, name: user.name },
        plate: normalizedPlate 
    };
}
