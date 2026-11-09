// Simulador de la DEMO: genera pasadas LPR ficticias cada pocos minutos para que el monitor se vea vivo.
const { PrismaClient } = require("@prisma/client");
const http = require("http"); const fs = require("fs");
const p = new PrismaClient();
const D = JSON.parse(fs.readFileSync("/root/demo-veh.json", "utf8"));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const adentro = new Map(); // plate -> true si está adentro
const emit = (data) => { const b = JSON.stringify(data); const r = http.request({ host: "127.0.0.1", port: 10000, path: "/internal/emit", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(b) } }); r.on("error", () => {}); r.end(b); };
async function paso() {
  try {
    const h = (new Date(Date.now() - 3 * 3600000)).getUTCHours();
    const visita = Math.random() < 0.2; const v = visita ? pick(D.visitas) : pick(D.veh);
    const entra = visita ? !adentro.get(v.plate) : !adentro.get(v.plate) ? Math.random() < 0.5 : false;
    const cam = D.cams.find((c) => c.por === v.por && c.direction === (entra ? "ENTRY" : "EXIT"));
    adentro.set(v.plate, entra);
    const file = `demo_${v.plate}_${cam.name.replace(/\W+/g, "")}.jpg`;
    const decision = v.userId ? "GRANT" : "DENY";
    const ev = await p.accessEvent.create({ data: { deviceId: cam.id, userId: v.userId, timestamp: new Date(), accessType: "PLATE", direction: cam.direction, decision,
      plateNumber: v.plate, plateDetected: v.plate, snapshotPath: `/api/files/lpr-prod/demo/${file}`,
      details: `${!v.userId ? "ALERTA: Matrícula No Registrada. " : ""}Marca: ${v.marca}, Modelo: ${v.modelo}, Color: ${v.color}, Tipo: vehicle, Source: Camera, DEMO` },
      include: { device: true, user: { include: { unit: true, vehicles: true } } } });
    emit({ __event: "access_event", ...ev, direction: ev.direction });
    emit({ __event: "webhook-event", type: "LPR", deviceId: cam.id, direction: ev.direction, plate: v.plate });
  } catch (e) { console.error("sim", e.message); }
  const h = (new Date(Date.now() - 3 * 3600000)).getUTCHours();
  const espera = (h >= 7 && h <= 21 ? 40 : 240) * 1000 * (0.5 + Math.random());
  setTimeout(paso, espera);
}
setTimeout(paso, 5000);
console.log("Simulador DEMO activo");
