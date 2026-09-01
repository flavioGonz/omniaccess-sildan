const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
(async () => {
  const p = new PrismaClient();
  const hash = bcrypt.hashSync("OlivosAdmin2026", 12);
  let u = await p.user.findFirst({ where: { role: "ADMIN" } });
  if (!u) u = await p.user.create({ data: { name: "admin", username: "admin", role: "ADMIN" } });
  const c = await p.credential.findFirst({ where: { userId: u.id, type: "PASSWORD" } });
  if (c) await p.credential.update({ where: { id: c.id }, data: { value: hash } });
  else await p.credential.create({ data: { type: "PASSWORD", value: hash, userId: u.id } });
  const S = (k, v) => p.setting.upsert({ where: { key: k }, update: { value: v }, create: { key: k, value: v } });
  await S("MODULE_LPR", "true"); await S("MODULE_FACE", "false"); await S("MODULE_QUEUE", "false");
  await S("MODE_LPR", "WHITELIST");
  await S("S3_ENDPOINT", "http://127.0.0.1:9000"); await S("S3_ACCESS_KEY", "omniadmin");
  await S("S3_SECRET_KEY", "eb1618a64e01090f73f6d232"); await S("S3_BUCKET_LPR", "lpr-prod");
  await S("S3_BUCKET_FACE", "face"); await S("S3_BUCKET_QUEUE", "queue");
  console.log("admin id=" + u.id + " (admin / OlivosAdmin2026) + settings LPR OK");
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
