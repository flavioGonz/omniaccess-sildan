
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkData() {
    try {
        const userCount = await prisma.user.count();
        const eventCount = await prisma.accessEvent.count();
        const deviceCount = await prisma.device.count();

        console.log('--- DB DIAGNOSTIC ---');
        console.log(`Users: ${userCount}`);
        console.log(`Events: ${eventCount}`);
        console.log(`Devices: ${deviceCount}`);
        console.log('---------------------');
    } catch (e) {
        console.error('Error connecting to DB:', e);
    } finally {
        await prisma.$disconnect();
    }
}

checkData();
