
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const devices = await prisma.device.findMany();
    console.log('Devices:', JSON.stringify(devices, null, 2));
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
