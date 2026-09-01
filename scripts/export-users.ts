
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function exportEverything() {
    try {
        console.log("--- EXPORTADOR TOTAL OMNIACCESS ---");

        // 1. Exportar Grupos de Acceso
        const accessGroups = await prisma.accessGroup.findMany();

        // 2. Exportar Unidades / Lotes
        const units = await prisma.unit.findMany();

        // 3. Exportar Usuarios con todas sus relaciones
        const users = await prisma.user.findMany({
            include: {
                accessGroups: {
                    select: { id: true, name: true }
                },
                credentials: true,
                vehicles: true,
                unit: true
            }
        });

        const exportData = {
            metadata: {
                version: "2.0",
                exportedAt: new Date().toISOString(),
                totalUsers: users.length,
                totalUnits: units.length,
                totalGroups: accessGroups.length
            },
            accessGroups,
            units,
            users
        };

        const exportPath = path.join(process.cwd(), 'users_export.json');
        fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));

        console.log("================================================");
        console.log(`¡Exportación Exitosa!`);
        console.log(`- Usuarios: ${users.length}`);
        console.log(`- Unidades: ${units.length}`);
        console.log(`- Grupos: ${accessGroups.length}`);
        console.log(`Archivo: ${exportPath}`);
        console.log("================================================");

    } catch (e) {
        console.error("Error en la exportación:", e);
    } finally {
        await prisma.$disconnect();
    }
}

exportEverything();
