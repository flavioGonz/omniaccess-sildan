const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
    const s = await prisma.setting.findUnique({ where: { key: 'S3_ENDPOINT' } });
    console.log(JSON.stringify(s, null, 2));
}
run().finally(() => prisma.$disconnect());
