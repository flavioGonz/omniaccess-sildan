const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
// Carga inicial de una instalación nueva. La clave del admin y la del MinIO se pasan por el
// entorno: estaban escritas acá (con el nombre de otro barrio en la clave) y correr este script
// por error le reseteaba la clave al admin de un barrio en producción a un valor conocido.
//   SEED_ADMIN_PASS=... S3_SECRET_KEY=... node seed.js
const CLAVE = process.env.SEED_ADMIN_PASS;
const S3_SECRETO = process.env.S3_SECRET_KEY;
if (!CLAVE || CLAVE.length < 10 || !S3_SECRETO) {
  console.error("Falta SEED_ADMIN_PASS (10+ caracteres) o S3_SECRET_KEY en el entorno. No se tocó nada.");
  process.exit(1);
}
(async () => {
  const p = new PrismaClient();
  const hash = bcrypt.hashSync(CLAVE, 12);
  let u = await p.user.findFirst({ where: { role: "ADMIN" } });
  if (!u) u = await p.user.create({ data: { name: "admin", username: "admin", role: "ADMIN" } });
  const c = await p.credential.findFirst({ where: { userId: u.id, type: "PASSWORD" } });
  if (c) await p.credential.update({ where: { id: c.id }, data: { value: hash } });
  else await p.credential.create({ data: { type: "PASSWORD", value: hash, userId: u.id } });
  const S = (k, v) => p.setting.upsert({ where: { key: k }, update: { value: v }, create: { key: k, value: v } });
  await S("MODULE_LPR", "true"); await S("MODULE_FACE", "false"); await S("MODULE_QUEUE", "false");
  await S("MODE_LPR", "WHITELIST");
  await S("S3_ENDPOINT", "http://127.0.0.1:9000"); await S("S3_ACCESS_KEY", "omniadmin");
  await S("S3_SECRET_KEY", S3_SECRETO); await S("S3_BUCKET_LPR", "lpr-prod");
  await S("S3_BUCKET_FACE", "face"); await S("S3_BUCKET_QUEUE", "queue");
  console.log("admin id=" + u.id + " (usuario admin, clave de SEED_ADMIN_PASS) + settings LPR OK");
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
