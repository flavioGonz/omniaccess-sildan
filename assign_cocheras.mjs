// Asigna la cochera (parkingSlot del lote) al TITULAR de cada casa del relevamiento,
// solo si la plaza está libre y el titular no tiene ya una. Idempotente.
//   node assign_cocheras.mjs --dry   |   --apply
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
const MODE = process.argv.includes('--apply') ? 'apply' : 'dry';
const env = fs.readFileSync('/opt/OmniAccess/.env', 'utf8');
const DBURL = (env.match(/DATABASE_URL="?([^"\n]+)"?/) || [])[1];
const prisma = new PrismaClient({ datasources: { db: { url: DBURL } } });
const payload = JSON.parse(fs.readFileSync(new URL('./import_payload.json', import.meta.url)));
const loteNorm = (x) => { x = (x || '').trim().toUpperCase().replace(/\s+/g, ''); const m = x.match(/^([A-Z]+)0*(\d+)(.*)$/); return m ? `${m[1]}${m[2]}${m[3]}` : x; };

const stats = { asignadas: 0, ya_tenia_titular: 0, plaza_ocupada_otro: 0, sin_plaza: 0, sin_titular: 0, muestra: [] };

const units = await prisma.unit.findMany({ select: { id: true, name: true } });
const unitIdx = new Map(units.map(u => [loteNorm(u.name), u]));

for (const L of payload.lotes) {
  const unit = unitIdx.get(loteNorm(L.lote));
  if (!unit) continue;
  const slots = await prisma.parkingSlot.findMany({ where: { unitId: unit.id }, include: { user: true } });
  if (!slots.length) { stats.sin_plaza++; continue; }
  const slot = slots[0];
  const titular = await prisma.user.findFirst({ where: { name: L.titular, unitId: unit.id } });
  if (!titular) { stats.sin_titular++; continue; }
  if (titular.parkingSlotId) { stats.ya_tenia_titular++; continue; }
  if (slot.user) { stats.plaza_ocupada_otro++; if (stats.muestra.length < 20) stats.muestra.push(`= ${unit.name}: plaza ${slot.label} ya la tiene ${slot.user.name} (titular ${L.titular} queda sin cochera)`); continue; }
  if (stats.muestra.length < 40) stats.muestra.push(`+ ${unit.name}: plaza ${slot.label} -> ${L.titular}`);
  if (MODE === 'apply') await prisma.user.update({ where: { id: titular.id }, data: { parkingSlotId: slot.id } });
  stats.asignadas++;
}

console.log(`\n==== ASIGNAR COCHERAS — MODO ${MODE.toUpperCase()} ====`);
for (const [k, v] of Object.entries(stats)) { if (k === 'muestra') continue; console.log(`  ${k}: ${v}`); }
console.log('\nMuestra:'); for (const s of stats.muestra) console.log('  ' + s);
await prisma.$disconnect();
