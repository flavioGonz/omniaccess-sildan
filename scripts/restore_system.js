
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function restore() {
    try {
        console.log('--- SYSTEM RESTORE STARTED ---');

        // 1. Read Backup File
        const backupPath = path.join(__dirname, 'users_export.json');
        if (!fs.existsSync(backupPath)) {
            console.error('Backup file users_export.json not found!');
            return;
        }
        const backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

        // 2. Clear Database (Safe measure)
        try {
            await prisma.accessEvent.deleteMany({});
            await prisma.credential.deleteMany({});
            await prisma.vehicle.deleteMany({});
            await prisma.user.deleteMany({});
            await prisma.parkingSlot.deleteMany({});
            await prisma.unit.deleteMany({});
            await prisma.accessGroup.deleteMany({});
            await prisma.device.deleteMany({});
            console.log('Database cleared.');
        } catch (e) {
            console.log('Error clearing DB, maybe already empty:', e.message);
        }

        // 3. Restore Access Groups
        console.log(`Restoring ${backupData.accessGroups.length} access groups...`);
        const groupMap = new Map(); // Old ID -> New ID
        for (const group of backupData.accessGroups) {
            const newGroup = await prisma.accessGroup.create({
                data: {
                    name: group.name,
                    // Add schedules if needed
                }
            });
            groupMap.set(group.id, newGroup.id);
        }

        // 4. Restore Units
        console.log(`Restoring ${backupData.units.length} units...`);
        const unitMap = new Map();
        for (const unit of backupData.units) {
            const newUnit = await prisma.unit.create({
                data: {
                    name: unit.name,
                    type: unit.type,
                    floors: unit.floors, // Corrected field name schema
                    // Map other fields
                }
            });
            unitMap.set(unit.id, newUnit.id);
        }

        // 5. Restore Users & Credentials
        console.log(`Restoring ${backupData.users.length} users with credentials...`);
        for (const user of backupData.users) {
            const unitId = user.unitId ? unitMap.get(user.unitId) : null;

            const newUser = await prisma.user.create({
                data: {
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    unitId: unitId,
                    accessGroups: {
                        connect: user.accessGroups.map(gid => {
                            const newGid = groupMap.get(gid);
                            return newGid ? { id: newGid } : null;
                        }).filter(g => g !== null)
                    }
                }
            });

            // Credentials
            if (user.credentials && user.credentials.length > 0) {
                await prisma.credential.createMany({
                    data: user.credentials.map(c => ({
                        type: c.type,
                        value: c.value,
                        userId: newUser.id
                    }))
                });
            }

            // Vehicles
            if (user.vehicles && user.vehicles.length > 0) {
                for (const v of user.vehicles) {
                    await prisma.vehicle.create({
                        data: {
                            plate: v.plate,
                            brand: v.brand,
                            model: v.model,
                            color: v.color,
                            type: v.type,
                            userId: newUser.id
                        }
                    })
                }
            }
        }

        // 6. Restore Devices (Manual Creation based on typical setup)
        console.log('Creating default devices...');

        // Hikvision LPR
        await prisma.device.create({
            data: {
                name: 'HIKVISION LPR',
                ip: '192.168.99.200', // Default guess, user can edit
                brand: 'HIKVISION',
                deviceType: 'LPR_CAMERA', // Corrected
                deviceModel: 'DS-2CD4A26FWD-IZS',
                username: 'admin',
                password: 'password123', // Placeholder
                location: 'Acceso Principal'
            }
        });

        // Akuvox Door
        await prisma.device.create({
            data: {
                name: 'AKUVOX R20A',
                ip: '192.168.99.135', // Typical IP from previous logs
                brand: 'AKUVOX',
                deviceType: 'FACE_TERMINAL', // Corrected
                deviceModel: 'R20A',
                username: 'admin',
                password: 'admin', // Placeholder
                location: 'Puerta Principal'
            }
        });

        console.log('--- RESTORE COMPLETED SUCCESSFULLY ---');

    } catch (error) {
        console.error('RESTORE FAILED:', error);
    } finally {
        await prisma.$disconnect();
    }
}

restore();
