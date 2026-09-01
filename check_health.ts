const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  try {
    const devices = await prisma.device.count();
    console.log(`Device count: ${devices}`);
    const events = await prisma.accessEvent.count();
    console.log(`AccessEvent count: ${events}`);
    console.log("DATABASE IS HEALTHY ✅");
  } catch (e) {
    console.error("DATABASE IS STILL CORRUPT ❌:", (e as any).message);
  } finally {
    await prisma.$disconnect();
  }
}

check();
