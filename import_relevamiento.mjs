// Importador del relevamiento de vehículos de Los Olivos -> OmniAccess (CT200)
// Uso:  node import_relevamiento.mjs --dry   (solo plan, no escribe)
//       node import_relevamiento.mjs --apply (aplica en una transacción)
// Requiere: import_payload.json en el mismo dir, y correr desde /opt/OmniAccess
import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const MODE = process.argv.includes('--apply') ? 'apply' : 'dry';
const CLEANUP = process.argv.includes('--cleanup'); // borrar placeholders que queden vacíos

// DATABASE_URL desde .env
const envTxt = fs.readFileSync('/opt/OmniAccess/.env', 'utf8');
const m = envTxt.match(/DATABASE_URL="?([^"\n]+)"?/);
const DBURL = m ? m[1] : process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url: DBURL } } });

const payload = JSON.parse(fs.readFileSync(new URL('./import_payload.json', import.meta.url)));

const loteNorm = (x) => {
  x = (x || '').trim().toUpperCase().replace(/\s+/g, '');
  const mm = x.match(/^([A-Z]+)0*(\d+)(.*)$/);
  return mm ? `${mm[1]}${mm[2]}${mm[3]}` : x;
};
const guessType = (brand, model, rel) => {
  const s = `${brand} ${model} ${rel || ''}`.toLowerCase();
  if (/(zanella|motomel|vespa|yumbo|winner|moto|scooter|sapucay)/.test(s)) return 'MOTORCYCLE';
  if (/(cami[oó]n|truck)/.test(s)) return 'TRUCK';
  if (/(hilux|frontier|ranger|amarok|saveiro|strada|oroch|s10|l200|dmax|d-max|pickup|pick-up|camioneta|fiorino|riddara|toro)/.test(s)) return 'PICKUP';
  if (/(kangoo|partner|berlingo|bipper|kombi|van|transit|ducato|master|sprinter|k01h|jumper)/.test(s)) return 'VAN';
  if (/(suv|crv|cr-v|xv|forester|tiguan|kona|captiva|seltos|duster|pilot|xc40|x5|x3|x6|ix|yuan|tang|creta|kicks|compass|tucson|santa|rav4|q3|q5|glc|tera)/.test(s)) return 'SUV';
  return 'SEDAN';
};

const stats = {
  units_reused: 0, units_created: 0, units_updated_contact: 0,
  users_created: 0, users_found: 0,
  vehicles_created: 0, vehicles_enriched: 0, creds_created: 0,
  prov_users_created: 0, prov_vehicles_created: 0,
  placeholders_emptied: [], sample: []
};

async function findUnitByLote(lote) {
  const ln = loteNorm(lote);
  const all = await prisma.unit.findMany({ where: { OR: [{ name: lote }, { name: ln }] } });
  let u = all.find(x => loteNorm(x.name) === ln);
  if (u) return { unit: u, created: false };
  // buscar en todas por normalización (una vez)
  return { unit: null, created: false, ln };
}

async function run() {
  console.log(`\n==== IMPORT relevamiento Los Olivos — MODO: ${MODE.toUpperCase()}${CLEANUP ? ' +cleanup' : ''} ====\n`);

  // índice normalizado de todas las units (para no duplicar)
  const allUnits = await prisma.unit.findMany({ select: { id: true, name: true } });
  const unitIdx = new Map();
  for (const u of allUnits) unitIdx.set(loteNorm(u.name), u);

  const ops = async (tx) => {
    for (const L of payload.lotes) {
      const ln = loteNorm(L.lote);
      let unit = unitIdx.get(ln);
      if (!unit) {
        stats.units_created++;
        if (MODE === 'apply') {
          unit = await tx.unit.create({ data: { name: ln, lot: L.lote, type: 'CASA', number: '' } });
          unitIdx.set(ln, unit);
        } else { unit = { id: `(new ${ln})`, name: ln }; unitIdx.set(ln, unit); }
        stats.sample.push(`+ Unit CASA '${ln}'`);
      } else stats.units_reused++;

      // titular en la Unit
      stats.units_updated_contact++;
      if (MODE === 'apply') {
        await tx.unit.update({ where: { id: unit.id }, data: {
          contactName: L.titular || null, contactEmail: L.titular_mail || null, adminPhone: L.titular_tel || null } });
      }

      for (const r of L.residents) {
        // usuario por (name + unit)
        let user = null;
        if (unit.id && !String(unit.id).startsWith('(')) {
          user = await tx.user.findFirst({ where: { name: r.name, unitId: unit.id } });
        }
        if (!user) {
          stats.users_created++;
          if (MODE === 'apply') {
            user = await tx.user.create({ data: {
              name: r.name, role: 'RESIDENT', unitId: unit.id,
              email: r.mail || null, phone: r.tel || null,
              observations: r.obs || null } });
          } else user = { id: `(new user ${r.name}@${ln})` };
          if (stats.sample.length < 30) stats.sample.push(`  + User RESIDENT '${r.name}' (${ln}) tel=${r.tel} mail=${r.mail}${r.obs ? ' ['+r.obs+']' : ''}`);
        } else {
          stats.users_found++;
          if (MODE === 'apply') await tx.user.update({ where: { id: user.id }, data: {
            email: r.mail || user.email, phone: r.tel || user.phone, observations: r.obs || user.observations } });
        }

        for (const pl of r.plates) {
          const existing = await tx.vehicle.findUnique({ where: { plate: pl.plate }, include: { user: true } });
          const vType = guessType(pl.brand, pl.model, '');
          if (existing) {
            stats.vehicles_enriched++;
            const oldUserId = existing.userId;
            if (MODE === 'apply') {
              await tx.vehicle.update({ where: { id: existing.id }, data: {
                brand: pl.brand || existing.brand, model: pl.model || existing.model,
                color: pl.color || existing.color, type: vType, userId: user.id } });
              // mover credencial PLATE si estaba en el user viejo
              await tx.credential.updateMany({ where: { userId: oldUserId, type: 'PLATE', value: pl.plate }, data: { userId: user.id } });
              if (oldUserId !== user.id) stats._pendingCleanup?.add(oldUserId);
            }
            if (stats.sample.length < 30) stats.sample.push(`    ~ Vehicle ${pl.plate} enriquecer + reasignar a '${r.name}'`);
          } else {
            stats.vehicles_created++;
            if (MODE === 'apply') {
              await tx.vehicle.create({ data: {
                plate: pl.plate, brand: pl.brand || null, model: pl.model || null,
                color: pl.color || null, type: vType, userId: user.id } });
              const hasCred = await tx.credential.findFirst({ where: { type: 'PLATE', value: pl.plate } });
              if (!hasCred) { await tx.credential.create({ data: { type: 'PLATE', value: pl.plate, userId: user.id } }); stats.creds_created++; }
            } else stats.creds_created++;
          }
        }
      }
    }

    // ---- proveedores (agrupar por matrícula) ----
    const provByPlate = new Map();
    for (const p of payload.proveedores) {
      if (!provByPlate.has(p.plate)) provByPlate.set(p.plate, []);
      provByPlate.get(p.plate).push(p);
    }
    for (const [plate, list] of provByPlate) {
      const first = list[0];
      const lotes = [...new Set(list.map(x => x.lote).filter(Boolean))].join(', ');
      const rels = [...new Set(list.map(x => x.relacion).filter(Boolean))].join(', ');
      const name = first.name || `Proveedor ${plate}`;
      const notes = [rels && `Servicio: ${rels}`, lotes && `Lotes: ${lotes}`, first.mail && `Mail: ${first.mail}`].filter(Boolean).join(' · ');
      let user = await tx.user.findFirst({ where: { name, role: 'PROVIDER' } });
      if (!user) {
        stats.prov_users_created++;
        if (MODE === 'apply') user = await tx.user.create({ data: {
          name, role: 'PROVIDER', phone: first.tel || null, email: first.mail || null, observations: notes } });
        else user = { id: `(new prov ${name})` };
        if (stats.sample.length < 45) stats.sample.push(`  + PROVIDER '${name}' ${plate} [${notes}]`);
      }
      const existing = await tx.vehicle.findUnique({ where: { plate } });
      if (!existing) {
        stats.prov_vehicles_created++;
        if (MODE === 'apply') {
          await tx.vehicle.create({ data: { plate, brand: first.brand || null, model: first.model || null, color: first.color || null, type: guessType(first.brand, first.model, first.relacion), userId: user.id, notes } });
          const hasCred = await tx.credential.findFirst({ where: { type: 'PLATE', value: plate } });
          if (!hasCred) await tx.credential.create({ data: { type: 'PLATE', value: plate, userId: user.id } });
        }
      }
    }

    // ---- cleanup de placeholders vacíos ----
    if (CLEANUP && MODE === 'apply' && stats._pendingCleanup) {
      for (const uid of stats._pendingCleanup) {
        const u = await tx.user.findUnique({ where: { id: uid }, include: { vehicles: true, credentials: true } });
        if (u && /^(Usuario|Propietario)\s/i.test(u.name) && u.vehicles.length === 0 && u.credentials.length === 0) {
          await tx.user.delete({ where: { id: uid } });
          stats.placeholders_emptied.push(u.name);
        }
      }
    }
  };

  stats._pendingCleanup = new Set();
  if (MODE === 'apply') {
    await prisma.$transaction(ops, { timeout: 120000 });
  } else {
    // dry: ejecutar la lógica de conteo consultando la DB en modo lectura
    await ops(prisma);
  }

  console.log('RESUMEN:');
  for (const [k, v] of Object.entries(stats)) {
    if (k === 'sample' || k.startsWith('_')) continue;
    if (Array.isArray(v)) console.log(`  ${k}: ${v.length}${v.length ? ' -> ' + v.join(', ') : ''}`);
    else console.log(`  ${k}: ${v}`);
  }
  console.log('\nMUESTRA de operaciones:');
  for (const s of stats.sample) console.log(s);
  await prisma.$disconnect();
}
run().catch(async (e) => { console.error('ERROR:', e.message); await prisma.$disconnect(); process.exit(1); });
