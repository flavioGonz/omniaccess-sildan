#!/usr/bin/env node
/**
 * El receptor de GPS ENTERO (gps-receiver.js), andando de verdad, contra una base de mentira.
 *   node scripts/probar-gps-receptor.js
 *
 * Las reglas sueltas —cuándo es silencio, qué es un salto— tienen sus pruebas en probar-gt06.js.
 * Ésta prueba lo que esas no pueden: que el receptor las use bien. Levanta el receptor en otros
 * puertos, le conecta rastreadores que hablan GT06 por un socket de verdad y mira qué quedó
 * guardado y qué salió hacia las pantallas:
 *   · uno aceptado que estaba avisado como «dejó de reportar» → vuelve, y se dice cuánto estuvo;
 *   · una posición más vieja que la última no pisa el punto; una de pocos satélites tampoco;
 *   · un salto de 6 km en dos segundos no mueve el punto y avisa una vez;
 *   · sale de una geocerca cuyo lado estaba GUARDADO (como después de un reinicio) → avisa;
 *   · uno sin aceptar: se anota, no guarda historial; el que pasa el tope no entra; con la
 *     puerta cerrada no se anota ninguno, y el aceptado entra igual;
 *   · un Teltonika por el mismo puerto: saludo, posición, voltaje, y el aviso de inhibidor;
 *   · cinco conexiones de un escáner castigan a la IP, y el aceptado sigue entrando.
 *
 * La base de mentira es lo justo que el receptor usa de Prisma, en memoria. No prueba SQL: prueba
 * las decisiones.
 */
"use strict";
const Module = require("module");
const db = { equipos: new Map(), posiciones: [], eventos: [], geocercas: [{ id: "g1", nombre: "Base", lat: -34.9, lon: -56.16, radio: 200, activa: true, imeis: [] }], settings: new Map() };
const casa = (w, f) => Object.entries(w || {}).every(([k, v]) => {
    if (k === "NOT") return !casa(v, f);
    if (v && typeof v === "object" && !(v instanceof Date)) { if ("not" in v) return f[k] !== v.not; if ("lt" in v) return f[k] < v.lt; if ("gte" in v) return f[k] >= v.gte; return true; }
    return f[k] === v;
});
class PrismaClient {
    constructor() {
        this.gpsEquipo = {
            findUnique: async ({ where }) => (db.equipos.has(where.imei) ? { ...db.equipos.get(where.imei) } : null),
            create: async ({ data }) => { const f = { nombre: null, deviceId: null, vehicleId: null, lat: null, lon: null, velocidad: null, rumbo: null, cuando: null, encendido: null, voltaje: null, sinReporteDesde: null, lados: null, encendidoDesde: null, ...data }; db.equipos.set(data.imei, f); return f; },
            update: async ({ where, data }) => { const f = db.equipos.get(where.imei); if (!f) throw new Error("no existe"); Object.assign(f, data); return { ...f }; },
            updateMany: async ({ where, data }) => { let n = 0; for (const f of db.equipos.values()) if (casa(where, f)) { Object.assign(f, data); n++; } return { count: n }; },
            count: async ({ where }) => [...db.equipos.values()].filter((f) => casa(where, f)).length,
            findMany: async ({ where }) => [...db.equipos.values()].filter((f) => casa(where, f)),
        };
        this.gpsPosicion = { create: async ({ data }) => { db.posiciones.push(data); return data; }, deleteMany: async () => ({ count: 0 }) };
        this.gpsEvento = { create: async ({ data }) => { const f = { id: "ev" + db.eventos.length, ...data }; db.eventos.push(f); return f; }, deleteMany: async () => ({ count: 0 }) };
        this.gpsGeocerca = { findMany: async () => db.geocercas };
        this.setting = { findUnique: async ({ where }) => (db.settings.has(where.key) ? { value: db.settings.get(where.key) } : null) };
        this.vehicle = { findUnique: async () => null };
    }
    async $disconnect() {}
}
const r = Module._resolveFilename;
const FALSA = require("path").join(__dirname, "..", "node_modules", "@prisma", "client-de-mentira.js");
require.cache[FALSA] = { id: FALSA, filename: FALSA, loaded: true, exports: { PrismaClient } };
Module._resolveFilename = function (p, ...x) { return p === "@prisma/client" ? FALSA : r.call(this, p, ...x); };

process.env.GPS_PUERTO = "21341"; process.env.GPS_PUERTO_CONTROL = "21013"; process.env.GPS_CRUDO = "0"; process.env.WEBHOOK_PORT = "21999"; process.env.TRACKING_TOKEN = "";
process.env.GPS_PENDIENTES_MAX = "2"; process.env.GPS_RELEER_MS = "300";
const net = require("net"), assert = require("assert");
const OAS = require("path").join(__dirname, "..");
const g = require(OAS + "/lib-gt06.js");
// el emisor de eventos al panel: se escucha acá para ver qué saldría a las pantallas
const emitidos = [];
require("http").createServer((req, res) => { let c = ""; req.on("data", (x) => (c += x)); req.on("end", () => { try { emitidos.push(JSON.parse(c)); } catch {} res.end("ok"); }); }).listen(21999);
require(OAS + "/gps-receiver.js");

function trama(proto, datos, serie) { const cuerpo = Buffer.concat([Buffer.from([datos.length + 5, proto]), datos, Buffer.from([serie >> 8, serie & 0xff])]); const c = g.crcItu(cuerpo); return Buffer.concat([Buffer.from([0x78, 0x78]), cuerpo, Buffer.from([c >> 8, c & 0xff, 0x0d, 0x0a])]); }
const login = (imei, n) => trama(0x01, Buffer.from("0" + imei, "hex"), n);
function pos(lat, lon, vel, cuando, sats = 10, acc = 1) { const d = Buffer.alloc(29); d[0] = cuando.getUTCFullYear() - 2000; d[1] = cuando.getUTCMonth() + 1; d[2] = cuando.getUTCDate(); d[3] = cuando.getUTCHours(); d[4] = cuando.getUTCMinutes(); d[5] = cuando.getUTCSeconds(); d[6] = 0xc0 | sats; d.writeUInt32BE(Math.round(Math.abs(lat) * 60 * 30000), 7); d.writeUInt32BE(Math.round(Math.abs(lon) * 60 * 30000), 11); d[15] = vel; d.writeUInt16BE(0x1000 | 0x0800, 16); d[26] = acc; return trama(0x22, d, 9); }
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const conectar = () => new Promise((ok) => { const s = net.connect(21341, "127.0.0.1", () => ok(s)); s.recibido = []; s.on("data", (d) => s.recibido.push(d.toString("hex"))); s.on("error", () => {}); s.on("close", () => (s.cerrado = true)); });

(async () => {
    await dormir(400);
    const A = "865190075749880";
    db.equipos.set(A, { imei: A, nombre: "GPS Test", deviceId: "dev1", vehicleId: null, lat: -34.9, lon: -56.16, velocidad: 0, rumbo: 0, cuando: new Date(Date.now() - 3600_000), encendido: false, voltaje: 12.5, sinReporteDesde: new Date(Date.now() - 1800_000), lados: { g1: true }, encendidoDesde: null, ultimoLatido: new Date(Date.now() - 1800_000) });
    const s = await conectar();
    s.write(login(A, 1)); await dormir(150);
    assert.strictEqual(s.recibido[0], "787805010001d9dc0d0a", "acuse del login");
    // estaba avisado como callado: al presentarse, volvió
    assert.strictEqual(db.eventos.at(-1).tipo, "GPS_VOLVIO"); assert.match(db.eventos.at(-1).detalle, /Estuvo 30 min/);
    assert.strictEqual(db.equipos.get(A).sinReporteDesde, null);
    const t = Date.now();
    // adentro de Base, buena
    s.write(pos(-34.9, -56.16, 0, new Date(t - 9000))); await dormir(80);
    assert.strictEqual(db.posiciones.length, 1); assert.strictEqual(db.equipos.get(A).lat, -34.9);
    // una más vieja que la que se tiene: se guarda, no pisa
    s.write(pos(-34.95, -56.16, 0, new Date(t - 60_000))); await dormir(80);
    assert.strictEqual(db.posiciones.length, 2); assert.strictEqual(db.equipos.get(A).lat, -34.9, "la vieja no pisa");
    // pocos satélites: se guarda, no mueve
    s.write(pos(-34.901, -56.16, 0, new Date(t - 8000), 5)); await dormir(80);
    assert.strictEqual(db.equipos.get(A).lat, -34.9);
    // salto imposible: 6 km en 2 segundos
    const antes = db.eventos.length;
    s.write(pos(-34.955, -56.16, 30, new Date(t - 7000))); await dormir(80);
    assert.strictEqual(db.equipos.get(A).lat, -34.9, "el salto no mueve el punto");
    assert.strictEqual(db.eventos.length, antes + 1); assert.strictEqual(db.eventos.at(-1).tipo, "GPS_SALTO"); assert.strictEqual(db.eventos.at(-1).prioridad, 3);
    // vuelve a una posición normal, saliendo de Base (2 confirmaciones) → geocerca SALE; sembrada desde la base
    s.write(Buffer.concat([pos(-34.9025, -56.16, 30, new Date(t - 6000)), pos(-34.9030, -56.16, 30, new Date(t - 5000))])); await dormir(120);
    const sale = db.eventos.at(-1);
    assert.strictEqual(sale.tipo, "GPS_GEOCERCA_SALE"); assert.strictEqual(sale.detalle, "Base"); assert.strictEqual(sale.tarde, null); assert.strictEqual(sale.prioridad, null);
    assert.deepStrictEqual(db.equipos.get(A).lados, { g1: false }, "el lado queda guardado");
    assert.ok(db.equipos.get(A).encendidoDesde instanceof Date, "el motor cambió: se anota desde cuándo");
    assert.ok(emitidos.some((e) => e.__event === "gps_evento" && e.tipo === "GPS_GEOCERCA_SALE" && e.id), "el cruce va a la pantalla con su id");
    assert.ok(emitidos.filter((e) => e.__event === "gps_posicion").length >= 3);
    // el silencio: se fuerza el reloj (último contacto hace 20 minutos y arranque viejo no se puede: se prueba la función en sus pruebas). Acá, /salud.
    const salud = await (await fetch("http://127.0.0.1:21013/salud")).json();
    assert.strictEqual(salud.ok, true); assert.strictEqual(salud.enLinea, 1);

    // ── un Teltonika, por el MISMO puerto ──
    const tk = require(OAS + "/lib-teltonika.js");
    const T = "356307042441013";
    db.equipos.set(T, { imei: T, nombre: "Camión", deviceId: "dev2", vehicleId: null, protocolo: "GT06", lat: null, lon: null, velocidad: null, rumbo: null, cuando: null, encendido: null, voltaje: null, sinReporteDesde: null, lados: null, encendidoDesde: null, ultimoLatido: null });
    const paqueteTk = ({ cuando, lat, lon, vel = 0, evento = 0, es1 = {}, es2 = {} }) => {
        const r = Buffer.alloc(24); r.writeBigUInt64BE(BigInt(cuando.getTime()), 0); r.writeInt32BE(Math.round(lon * 1e7), 9); r.writeInt32BE(Math.round(lat * 1e7), 13); r[21] = 11; r.writeUInt16BE(vel, 22);
        const u = Object.entries(es1), d2 = Object.entries(es2);
        const io = Buffer.concat([Buffer.from([evento, u.length + d2.length, u.length]), ...u.map(([id, v]) => Buffer.from([Number(id), v])), Buffer.from([d2.length]), ...d2.map(([id, v]) => { const b = Buffer.alloc(3); b[0] = Number(id); b.writeUInt16BE(v, 1); return b; }), Buffer.from([0, 0])]);
        const datos = Buffer.concat([Buffer.from([0x08, 1]), r, io, Buffer.from([1])]);
        const cab = Buffer.alloc(8); cab.writeUInt32BE(datos.length, 4); const crc = Buffer.alloc(4); crc.writeUInt32BE(tk.crc16(datos));
        return Buffer.concat([cab, datos, crc]);
    };
    const st = await conectar();
    st.write(Buffer.concat([Buffer.from([0x00, 0x0f]), Buffer.from(T)])); await dormir(120);
    assert.strictEqual(st.recibido[0], "01", "el saludo de Teltonika se acepta con un 01");
    assert.strictEqual(db.equipos.get(T).protocolo, "TELTONIKA");
    st.write(paqueteTk({ cuando: new Date(), lat: -34.85, lon: -56.2, vel: 42, es1: { 239: 1, 21: 4 }, es2: { 66: 12650 } })); await dormir(120);
    assert.strictEqual(st.recibido[1], "00000001", "el acuse es la cuenta de registros");
    const eT = db.equipos.get(T);
    assert.strictEqual(eT.lat, -34.85); assert.strictEqual(eT.velocidad, 42); assert.strictEqual(eT.encendido, true); assert.strictEqual(eT.voltaje, 12.65); assert.strictEqual(eT.senal, 4);
    assert.strictEqual(db.posiciones.filter((p) => p.imei === T).length, 1);
    // el inhibidor: lo que un GT06 no sabe avisar
    st.write(paqueteTk({ cuando: new Date(), lat: -34.851, lon: -56.2, vel: 40, evento: 249, es1: { 249: 1 } })); await dormir(120);
    assert.strictEqual(db.eventos.at(-1).tipo, "GPS_INHIBIDOR"); assert.strictEqual(db.eventos.at(-1).prioridad, 1); assert.strictEqual(db.eventos.at(-1).imei, T);
    // y un comando a un Teltonika se rechaza con una explicación, no se le manda una trama de GT06
    const com = await (await fetch("http://127.0.0.1:21013/comando", { method: "POST", body: JSON.stringify({ imei: T, texto: "STATUS#" }) })).json();
    assert.strictEqual(com.ok, false); assert.match(com.error, /todavía no/);

    // ── los que no están aceptados ──
    const B = "111111111111111", s2 = await conectar();
    s2.write(login(B, 1)); await dormir(120);
    assert.strictEqual(s2.recibido.length, 1, "se anota y se le acusa");
    s2.write(pos(-34.8, -56.1, 50, new Date())); await dormir(80);
    assert.strictEqual(db.posiciones.filter((p) => p.imei === B).length, 0, "sin aceptar no guarda historial");
    assert.strictEqual(db.equipos.get(B).lat, -34.8, "pero sí dónde está");
    const s3 = await conectar(); s3.write(login("222222222222222", 1)); await dormir(100); assert.strictEqual(s3.recibido.length, 1);
    // el tercero pendiente no entra (tope en 2)
    const s4 = await conectar(); s4.write(login("333333333333333", 1)); await dormir(150);
    assert.strictEqual(s4.recibido.length, 0, "sin acuse"); assert.ok(s4.cerrado, "y cortado"); assert.ok(!db.equipos.has("333333333333333"));
    // puerta cerrada: ni siquiera con lugar
    db.equipos.delete("222222222222222"); db.settings.set("GPS_PUERTA", "cerrada");
    await dormir(700);                                               // el receptor relee la puerta (GPS_RELEER_MS)
    const s5 = await conectar(); s5.write(login("444444444444444", 1)); await dormir(150);
    assert.strictEqual(s5.recibido.length, 0); assert.ok(!db.equipos.has("444444444444444"), "puerta cerrada: no se anota");
    // …pero el aceptado sigue entrando
    const s6 = await conectar(); s6.write(login(A, 1)); await dormir(150); assert.strictEqual(s6.recibido.length, 1, "el aceptado entra igual");
    // basura: cinco conexiones de un escáner → castigada; el aceptado igual entra
    for (let i = 0; i < 5; i++) { const x = await conectar(); x.write(Buffer.alloc(5000, 0x41)); await dormir(60); }
    const s7 = await conectar(); s7.write(login(A, 2)); await dormir(150); assert.strictEqual(s7.recibido.length, 1, "castigada no es bloqueada para un aceptado");
    const salud2 = await (await fetch("http://127.0.0.1:21013/salud")).json();
    assert.strictEqual(salud2.castigadas, 1); assert.strictEqual(salud2.puerta, "cerrada");
    console.log(`  ✓ el receptor entero, con una base de mentira: ${db.eventos.map((e) => e.tipo).join(", ")} · ${salud2.rechazados} logins rechazados`);
    process.exit(0);
})().catch((e) => { console.error("  ✗ el receptor entero:", e.message); process.exit(1); });
