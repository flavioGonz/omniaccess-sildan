// Datos de DEMOSTRACIÓN (ficticios) para la instancia demo de OmniAccess. Idempotente: borra y recrea lo demo.
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const p = new PrismaClient();
let seed = 20261109; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const NOMBRES = ["Martín","Lucía","Santiago","Valentina","Joaquín","Camila","Mateo","Sofía","Nicolás","Florencia","Agustín","Micaela","Federico","Carolina","Diego","Paula","Gonzalo","Natalia","Rodrigo","Victoria","Sebastián","Lorena","Pablo","Andrea","Facundo","Mariana","Ignacio","Verónica","Emiliano","Gabriela"];
const APELLIDOS = ["Rodríguez","González","Fernández","Pereira","Martínez","Silva","Sosa","Méndez","Suárez","Núñez","Castro","Ferreira","Cabrera","Acosta","Olivera","Romero","Díaz","Álvarez","Benítez","Correa","Morales","Viera","Píriz","Techera","Bentancor"];
const MARCAS = [["Toyota","Corolla"],["Volkswagen","Gol"],["Chevrolet","Onix"],["Fiat","Cronos"],["Renault","Sandero"],["Peugeot","208"],["Hyundai","HB20"],["Ford","Ranger"],["Kia","Sportage"],["Suzuki","Swift"],["Nissan","Kicks"],["BYD","Dolphin"]];
const COLORES = ["Blanco","Gris","Plata","Negro","Rojo","Azul","Beige","Verde"];
const TIPOS = ["SEDAN","SEDAN","SUV","SUV","PICKUP","VAN"];
const LETRAS = "ABCDEFGHIJKLMNOPQRSTVWXYZ";
const usadas = new Set();
const chapa = () => { for (;;) { const c = "S" + LETRAS[Math.floor(rnd()*25)] + LETRAS[Math.floor(rnd()*25)] + String(1000 + Math.floor(rnd()*9000)); if (!usadas.has(c)) { usadas.add(c); return c; } } };
(async () => {
  const pass = process.env.DEMO_ADMIN_PASS || "SST.Demo.2026";
  // ---- Ajustes
  const S = (k, v) => p.setting.upsert({ where: { key: k }, update: { value: v }, create: { key: k, value: v } });
  const env = Object.fromEntries(fs.readFileSync("/opt/OmniAccess/.env","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1).replace(/^"|"$/g,"")]}));
  for (const [k,v] of Object.entries({ MODULE_LPR:"true", MODULE_FACE:"false", MODULE_QUEUE:"false", MODULE_GUARD:"true", MODE_LPR:"WHITELIST",
    S3_ENDPOINT:"http://127.0.0.1:9000", S3_ACCESS_KEY:"omniadmin", S3_SECRET_KEY:env.S3_SECRET_KEY, S3_BUCKET_LPR:"lpr-prod", S3_BUCKET_FACE:"face", S3_BUCKET_QUEUE:"queue", S3_BUCKET_INTRUSION:"intrusion",
    MERODEO_ENABLED:"true", MERODEO_COOLDOWN_MIN:"30", MERODEO_EXCLUDE_RESIDENTS:"true", MERODEO_WINDOW_MIN:"30", MERODEO_THRESHOLD:"4", MERODEO_GROUP_SEC:"120",
    INTERNAL_BASE_URL:"http://172.16.1.120:10001", BASE_URL:"https://omniaccess.sst.uy", EVENT_HOST_IP:"172.16.1.120", EVENT_HOST_PORT:"10000", EVENT_HOST_PATH:"/api/webhooks/hikvision",
    LPR_WEBHOOK_HOST:"172.16.1.120", LPR_WEBHOOK_PORT:"10000", LPR_WEBHOOK_URL:"/api/webhooks/hikvision", MODO_ACCESO:"CERRADO", TELEGRAM_ENABLED:"false", DISPATCH_TELEGRAM_ENABLED:"false",
    GUARD_MAIN_LOGO:"/logo-transparent.png", GUARD_TABLE_HEADER_COLOR:"#1e293b", MARCA_AGUA_POSICION:"sup-der", CLIP_INTRO_COLOR:"#0f172a" })) await S(k, v);
  if (fs.existsSync("/root/demo-ajustes.json")) for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync("/root/demo-ajustes.json", "utf8")))) await S(k, v);
  // ---- Admin
  const hash = bcrypt.hashSync(pass, 12);
  let adm = await p.user.findFirst({ where: { username: "admin" } });
  if (!adm) adm = await p.user.create({ data: { name: "admin", username: "admin", role: "ADMIN" } });
  const c = await p.credential.findFirst({ where: { userId: adm.id, type: "PASSWORD" } });
  if (c) await p.credential.update({ where: { id: c.id }, data: { value: hash } }); else await p.credential.create({ data: { type: "PASSWORD", value: hash, userId: adm.id } });
  // ---- Limpieza de lo demo anterior
  await p.accessEvent.deleteMany({ where: { details: { contains: "DEMO" } } });
  await p.vehicle.deleteMany({ where: { notes: "DEMO" } });
  await p.credential.deleteMany({ where: { notes: "DEMO" } });
  await p.user.deleteMany({ where: { createdBy: "DEMO" } });
  await p.unit.deleteMany({ where: { description: "DEMO" } });
  await p.device.deleteMany({ where: { location: { startsWith: "DEMO" } } });
  // ---- Cámaras (porterías ficticias)
  const cams = [];
  for (const [n, ip, dir, loc] of [["P1 - Entrada","10.99.0.11","ENTRY","DEMO P1"],["P1 - Salida","10.99.0.12","EXIT","DEMO P1"],["P2 - Entrada","10.99.0.21","ENTRY","DEMO P2"],["P2 - Salida","10.99.0.22","EXIT","DEMO P2"]])
    cams.push(await p.device.create({ data: { name: n, deviceType: "LPR_CAMERA", brand: "HIKVISION", deviceModel: "iDS-2CD7A46G0/P-IZHS", ip, direction: dir, location: loc, username: "admin", password: "demo" } }));
  const porteria = { P1: [cams[0], cams[1]], P2: [cams[2], cams[3]] };
  // ---- Lotes, residentes, vehículos
  const veh = []; const imgs = [];
  for (let i = 1; i <= 48; i++) {
    const u = await p.unit.create({ data: { name: `Lote ${i}`, number: String(i), lot: String(i), type: "CASA", description: "DEMO" } });
    const fam = pick(APELLIDOS); const n = 1 + Math.floor(rnd() * 3);
    for (let j = 0; j < n; j++) {
      const usr = await p.user.create({ data: { name: `${pick(NOMBRES)} ${fam}`, role: "RESIDENT", unitId: u.id, phone: "09" + Math.floor(1000000 + rnd()*8999999), createdBy: "DEMO" } });
      if (j < 2) {
        const [marca, modelo] = pick(MARCAS); const color = pick(COLORES); const plate = chapa();
        await p.vehicle.create({ data: { plate, brand: marca, model: modelo, color, type: pick(TIPOS), userId: usr.id, notes: "DEMO" } });
        await p.credential.create({ data: { type: "PLATE", value: plate, userId: usr.id, notes: "DEMO" } });
        veh.push({ plate, marca, modelo, color, userId: usr.id, por: rnd() < 0.65 ? "P1" : "P2", tipo: "R" });
      }
    }
  }
  // Proveedores / personal (con matrícula autorizada)
  for (const [emp, nombre] of [["Limpieza Brillante","Carlos Pintos"],["Jardines del Este","Raúl Fagúndez"],["Seguridad SST","Guardia Turno A"],["Piscinas Uy","Hernán Ríos"],["Gas Uruguay","Reparto"]]) {
    const usr = await p.user.create({ data: { name: nombre, role: "PROVIDER", empresa: emp, createdBy: "DEMO" } });
    const [marca, modelo] = pick(MARCAS); const plate = chapa(); const color = pick(COLORES);
    await p.vehicle.create({ data: { plate, brand: marca, model: modelo, color, type: pick(["VAN","PICKUP","TRUCK"]), userId: usr.id, notes: "DEMO" } });
    await p.credential.create({ data: { type: "PLATE", value: plate, userId: usr.id, notes: "DEMO" } });
    veh.push({ plate, marca, modelo, color, userId: usr.id, por: "P1", tipo: "P" });
  }
  // Visitas sin registro (se deniegan en lista blanca)
  const visitas = Array.from({ length: 40 }, () => { const [marca, modelo] = pick(MARCAS); return { plate: chapa(), marca, modelo, color: pick(COLORES), userId: null, por: rnd() < 0.7 ? "P1" : "P2", tipo: "V" }; });
  // Una matrícula en lista negra
  const bl = await p.user.create({ data: { name: "Vehículo observado", role: "BLACKLISTED", blacklistReason: "Incidente registrado (dato de demostración)", createdBy: "DEMO" } });
  const blPlate = chapa(); await p.vehicle.create({ data: { plate: blPlate, brand: "Chevrolet", model: "Prisma", color: "Gris", userId: bl.id, notes: "DEMO" } });
  await p.credential.create({ data: { type: "PLATE", value: blPlate, userId: bl.id, notes: "DEMO" } });
  const img = (v, cam) => { const f = `demo_${v.plate}_${cam.name.replace(/\W+/g,"")}.jpg`; imgs.push({ file: f, plate: v.plate, color: v.color, cam: cam.name }); return `/api/files/lpr-prod/demo/${f}`; };
  // ---- Historial de 30 días
  const ev = []; const now = Date.now(); const DIA = 86400000;
  const add = (v, cam, t, decision) => ev.push({ deviceId: cam.id, userId: v.userId, credentialId: null, timestamp: new Date(t), accessType: "PLATE", direction: cam.direction, decision,
      plateNumber: v.plate, plateDetected: v.plate, snapshotPath: img(v, cam), details: `${decision === "DENY" && !v.userId ? "ALERTA: Matrícula No Registrada. " : ""}Marca: ${v.marca}, Modelo: ${v.modelo}, Color: ${v.color}, Tipo: vehicle, Source: Camera, DEMO` });
  for (let d = 30; d >= 0; d--) {
    const base = now - d * DIA; const dia = new Date(base); dia.setUTCHours(3, 0, 0, 0); const t0 = dia.getTime(); // 00:00 Montevideo
    for (const v of veh) {
      const viajes = v.tipo === "P" ? (rnd() < 0.7 ? 1 : 0) : (rnd() < 0.85 ? 1 + (rnd() < 0.35 ? 1 : 0) : 0);
      for (let k = 0; k < viajes; k++) {
        const [ent, sal] = porteria[v.por];
        const sale = t0 + (7 + rnd() * 11) * 3600000; const vuelve = sale + (0.5 + rnd() * 7) * 3600000;
        if (sale < now) add(v, sal, sale, "GRANT"); if (vuelve < now) add(v, ent, vuelve, "GRANT");
      }
    }
    for (let k = 0; k < 6 + Math.floor(rnd() * 10); k++) {
      const v = pick(visitas); const [ent, sal] = porteria[v.por]; const t = t0 + (9 + rnd() * 11) * 3600000;
      if (t < now) add(v, ent, t, "DENY"); if (t + 1800000 < now && rnd() < 0.8) add(v, sal, t + (0.3 + rnd()) * 3600000, "DENY");
    }
    if (rnd() < 0.15) { const t = t0 + (13 + rnd() * 8) * 3600000; if (t < now) add({ plate: blPlate, marca: "Chevrolet", modelo: "Prisma", color: "Gris", userId: bl.id }, porteria.P2[0], t, "DENY"); }
  }
  ev.sort((a, b) => a.timestamp - b.timestamp);
  for (let i = 0; i < ev.length; i += 1000) await p.accessEvent.createMany({ data: ev.slice(i, i + 1000) });
  for (const v of [...veh, ...visitas]) for (const cam of porteria[v.por]) img(v, cam);
  const uniq = [...new Map(imgs.map((x) => [x.file, x])).values()];
  fs.writeFileSync("/root/demo-imgs.json", JSON.stringify(uniq));
  fs.writeFileSync("/root/demo-veh.json", JSON.stringify({ veh, visitas, cams: cams.map((c) => ({ id: c.id, name: c.name, direction: c.direction, por: c.location.slice(5) })) }));
  console.log(`admin listo · lotes 48 · vehículos ${veh.length} · visitas ${visitas.length} · eventos ${ev.length} · imágenes ${uniq.length}`);
})().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
