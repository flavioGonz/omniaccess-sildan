
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function importEverything() {
    console.log("--- MIGRATOR V8 (FULL SYNC) ---");
    try {
        const importPath = path.join(process.cwd(), 'users_export.json');

        if (!fs.existsSync(importPath)) {
            console.error("Archivo users_export.json no encontrado!");
            return;
        }

        const rawData = fs.readFileSync(importPath, 'utf-8');
        const data = JSON.parse(rawData);

        // Si el archivo es del formato viejo (solo array de usuarios), lo envolvemos
        const exportData = Array.isArray(data) ? { users: data, units: [], accessGroups: [] } : data;

        console.log(`Cargados: ${exportData.users.length} usuarios, ${exportData.units?.length || 0} unidades.`);

        // 1. IMPORTAR GRUPOS DE ACCESO
        if (exportData.accessGroups) {
            console.log("Sincronizando Grupos de Acceso...");
            for (const g of exportData.accessGroups) {
                await prisma.accessGroup.upsert({
                    where: { id: g.id },
                    update: { name: g.name },
                    create: { id: g.id, name: g.name }
                });
            }
        }

        // 2. IMPORTAR UNIDADES
        if (exportData.units) {
            console.log("Sincronizando Unidades...");
            for (const u of exportData.units) {
                await prisma.unit.upsert({
                    where: { id: u.id },
                    update: { name: u.name, type: u.type },
                    create: { id: u.id, name: u.name, type: u.type }
                });
            }
        }

        // 3. IMPORTAR USUARIOS
        let newRecords = 0;
        let updatedRecords = 0;

        for (const user of exportData.users) {
            const { id, accessGroups, credentials, vehicles, unit, createdAt, updatedAt, ...userData } = user;

            if (userData.dni && userData.dni.trim() === "") userData.dni = null;
            if (userData.email && userData.email.trim() === "") userData.email = null;
            if (!userData.phone) userData.phone = "N/A";

            // Buscar por email o DNI
            const searchConditions = [];
            if (userData.email) searchConditions.push({ email: userData.email });
            if (userData.dni) searchConditions.push({ dni: userData.dni });

            let existing = null;
            if (searchConditions.length > 0) {
                existing = await prisma.user.findFirst({
                    where: { OR: searchConditions }
                });
            }

            let targetUserId = existing?.id;

            if (!existing) {
                try {
                    const newUser = await prisma.user.create({ data: userData });
                    targetUserId = newUser.id;
                    newRecords++;
                    console.log(`  [NUEVO] ${user.name}`);
                } catch (e: any) {
                    console.error(`  [ERROR] No se pudo crear a ${user.name}: ${e.message}`);
                    continue;
                }
            } else {
                // Actualizar datos básicos si ya existe
                await prisma.user.update({
                    where: { id: existing.id },
                    data: userData
                });
            }

            // VINCULAR A GRUPOS
            if (accessGroups && targetUserId) {
                for (const g of accessGroups) {
                    await prisma.user.update({
                        where: { id: targetUserId },
                        data: {
                            accessGroups: { connect: { id: g.id } }
                        }
                    }).catch(() => { });
                }
            }

            // PROCESAR VEHÍCULOS (Reasignación robusta)
            if (vehicles && targetUserId) {
                for (const v of vehicles) {
                    if (!v.plate) continue;
                    try {
                        const plateExists = await prisma.vehicle.findUnique({ where: { plate: v.plate } });
                        if (!plateExists) {
                            await prisma.vehicle.create({
                                data: {
                                    plate: v.plate,
                                    brand: v.brand,
                                    model: v.model,
                                    color: v.color,
                                    type: v.type,
                                    userId: targetUserId
                                }
                            });
                            updatedRecords++;
                        } else {
                            // Reasignar si es de otro
                            await prisma.vehicle.update({
                                where: { plate: v.plate },
                                data: { userId: targetUserId }
                            });
                        }
                    } catch (err) { }
                }
            }

            // PROCESAR CREDENCIALES
            if (credentials && targetUserId) {
                for (const c of credentials) {
                    const val = c.value || c.code;
                    if (!val) continue;
                    try {
                        const hasCred = await prisma.credential.findFirst({
                            where: { value: String(val), type: c.type }
                        });
                        if (!hasCred) {
                            await prisma.credential.create({
                                data: {
                                    type: c.type,
                                    value: String(val),
                                    notes: c.notes,
                                    userId: targetUserId
                                }
                            });
                        } else {
                            await prisma.credential.update({
                                where: { id: hasCred.id },
                                data: { userId: targetUserId }
                            });
                        }
                    } catch (e) { }
                }
            }
        }

        console.log("================================================");
        console.log(`MIGRACIÓN COMPLETADA V8`);
        console.log("================================================");

    } catch (e) {
        console.error("Error crítico:", e);
    } finally {
        await prisma.$disconnect();
    }
}

importEverything();
