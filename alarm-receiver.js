/**
 * alarm-receiver — el receptor de centrales de alarma (Alarm Hub) por SIA DC-09.
 * openspec/changes/alarm-hub-sia-dc09 (21/10, Nico: «centrales de alarma por SIA DC-09»).
 *
 * Proceso propio de PM2 y no parte de server.js (D1): tiene sockets largos y otro puerto, y no
 * tiene por qué caerse con los webhooks de las cámaras ni pedir permiso para reiniciarlos. Escucha
 * TCP y UDP en ALARMAS_PUERTO (10010) y por cada trama:
 *
 *   leer (lib-dc09) → ¿cuenta conocida? → ¿cifrada si tiene que? → ¿hora en ventana? → ¿repetida?
 *     → ACK + guardar + traducir (lib-dc09-codigos) → ALARMA: Detection type CENTRAL, foto de las
 *       cámaras de la zona, socket y reglas de aviso
 *     → si algo falla: NAK (con la hora del receptor) o DUH (ID desconocido)
 *
 * Seguridad (D3), porque el puerto queda en internet:
 *  · una cuenta que no está dada de alta recibe NAK — no se le confirma nada a quien no se conoce;
 *  · una central por internet tiene que mandar cifrado (salvo «LAN/VPN» en su ficha);
 *  · un mensaje cifrado fuera de la ventana de hora es NAK: impide reenviar uno grabado;
 *  · el reintento de la central (mismo seq y hora) se contesta ACK otra vez SIN un segundo evento;
 *  · límites: tamaño de trama, conexiones por IP, inactividad, y cuánto se anota por IP por minuto
 *    (un escáner no llena la base).
 *  · la clave AES vive cifrada en la base (OMNI_CLAVE_DATOS) y nunca se escribe en el log.
 *
 * La supervisión («Sin supervisión») y las fallas abiertas las evalúa la salud de Next
 * (src/lib/centrales/supervision.ts), que es la que manda las alertas: acá sólo se anota cuándo
 * habló cada central.
 */
"use strict";
require("dotenv").config({ quiet: true });
const net = require("net");
const dgram = require("dgram");
const http = require("http");
const { PrismaClient } = require("@prisma/client");
const dc = require("./lib-dc09");
const cod = require("./lib-dc09-codigos");
const { descifrar } = require("./lib-cifrado-datos");

// Claves de los equipos cifradas en la base: se leen descifradas (lib-cifrado-datos, punto 5).
const prisma = require("./lib-cifrado-datos").enPrisma(new PrismaClient());
const PUERTO = Number(process.env.ALARMAS_PUERTO || 10010);
const VENTANA_SEG = Number(process.env.ALARMAS_VENTANA_SEG || 40);
const RELEER_MS = 30_000;
const CONEXIONES_POR_IP = 8;
const INACTIVO_MS = 180_000;
/** Cuántos mensajes rechazados se anotan por IP y por minuto: el resto sólo se cuenta. */
const ANOTAR_POR_MIN = 20;
/** Anti-repetición: cuánto se recuerda un mensaje ya contestado. */
const REPETIDO_MS = 15 * 60_000;
const GO2RTC = process.env.GO2RTC_API || "http://127.0.0.1:1984";
const WEBHOOKS = Number(process.env.WEBHOOK_PORT || 10000);

const log = (...a) => console.log(new Date().toISOString(), "[centrales]", ...a);

// ── Centrales dadas de alta ───────────────────────────────────────────────────────────────────
let centrales = new Map(); // cuenta → { id, deviceId, nombre, clave, modoClave, lanVpn, prueba }
let leidas = 0;
async function releer() {
    try {
        const filas = await prisma.centralAlarma.findMany({ include: { device: { select: { name: true } } } });
        const m = new Map();
        for (const c of filas) {
            let clave = null;
            try { clave = c.claveCifrada ? descifrar(c.claveCifrada) : null; } catch (e) { log(`no se pudo descifrar la clave de la cuenta ${c.cuenta}: ¿cambió OMNI_CLAVE_DATOS?`); }
            m.set(c.cuenta.toUpperCase(), { id: c.id, deviceId: c.deviceId, nombre: c.device?.name || `Central ${c.cuenta}`, clave, modoClave: c.modoClave, lanVpn: c.lanVpn, prueba: c.prueba });
        }
        centrales = m; leidas = Date.now();
    } catch (e) { log("no se pudieron leer las centrales:", e.message); }
}
let releyendo = null;
async function centralDe(cuenta) {
    let c = centrales.get(String(cuenta).toUpperCase());
    // Una cuenta que no está puede ser una central recién dada de alta: se relee, como mucho cada 5 s.
    if (!c && Date.now() - leidas > 5_000) { releyendo ??= releer().finally(() => { releyendo = null; }); await releyendo; c = centrales.get(String(cuenta).toUpperCase()); }
    return c || null;
}

// ── Límites por IP ────────────────────────────────────────────────────────────────────────────
const anotados = new Map(); // ip → { min, n, callados }
function puedoAnotar(ip) {
    const min = Math.floor(Date.now() / 60_000);
    const a = anotados.get(ip) || { min, n: 0, callados: 0 };
    if (a.min !== min) { if (a.callados) log(`${ip}: ${a.callados} mensajes rechazados más sin anotar en el último minuto`); a.min = min; a.n = 0; a.callados = 0; }
    a.n++; anotados.set(ip, a);
    if (a.n > ANOTAR_POR_MIN) { a.callados++; return false; }
    return true;
}
setInterval(() => { const min = Math.floor(Date.now() / 60_000); for (const [ip, a] of anotados) if (min - a.min > 5) anotados.delete(ip); }, 60_000).unref();

const repetidos = new Map(); // clave → ms
setInterval(() => { const t = Date.now() - REPETIDO_MS; for (const [k, v] of repetidos) if (v < t) repetidos.delete(k); }, 60_000).unref();

// ── Avisos a la app ──────────────────────────────────────────────────────────────────────────
function emitir(evento, datos) {
    try {
        const cuerpo = JSON.stringify({ __event: evento, ...datos });
        const req = http.request({ hostname: "127.0.0.1", port: WEBHOOKS, path: "/internal/emit", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(cuerpo) }, timeout: 2000 });
        req.on("error", () => { }); req.on("timeout", () => req.destroy());
        req.write(cuerpo); req.end();
    } catch { }
}
async function avisarPorReglas(ev) {
    try {
        let token = process.env.TRACKING_TOKEN || "";
        if (!token) token = (await prisma.setting.findUnique({ where: { key: "TRACKING_TOKEN" } }))?.value || "";
        if (!token) return;
        const r = await fetch(`${process.env.INTERNAL_BASE_URL || "http://127.0.0.1:10001"}/api/notifications/event`, {
            method: "POST", headers: { "Content-Type": "application/json", "x-tracking-token": token }, body: JSON.stringify(ev), signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) log(`reglas: /api/notifications/event respondió ${r.status}`);
    } catch (e) { log("reglas: no se pudo avisar:", e.message); }
}
/** Un cuadro de una cámara (por go2rtc, como el diagnóstico de imagen) subido a S3 bucket intrusion. */
async function fotoDe(camaraId, nombre) {
    try {
        const r = await fetch(`${GO2RTC}/api/frame.jpeg?src=${encodeURIComponent(`lpr_${camaraId}`)}`, { signal: AbortSignal.timeout(6000) });
        if (!r.ok) return null;
        const b = Buffer.from(await r.arrayBuffer());
        if (b.length < 2000) return null;
        const { uploadToS3 } = require("./lib-s3");
        return await uploadToS3(b, nombre, "image/jpeg", "intrusion");
    } catch { return null; }
}

// ── Un mensaje ───────────────────────────────────────────────────────────────────────────────
const TIPO_ROTULO = { ROBO: "Robo", PANICO: "Pánico", INCENDIO: "Incendio", SABOTAJE: "Sabotaje", COACCION: "Coacción", MEDICA: "Emergencia médica", GAS: "Gas", AGUA: "Agua", TEMPERATURA: "Temperatura", GENERAL: "Alarma" };

async function registrar(datos) {
    return prisma.mensajeCentral.create({ data: datos }).catch((e) => { log("no se pudo guardar el mensaje:", e.message); return null; });
}

/** Procesa una trama y devuelve la respuesta (o null si no hay que contestar). */
async function procesar(trama, ip, transporte) {
    const crudo = String(trama).replace(/[\r\n]/g, "").slice(0, 2000);
    const m = dc.leer(trama, (cuenta) => centrales.get(String(cuenta).toUpperCase())?.clave || null);
    // Si la cuenta no estaba en memoria y el mensaje venía cifrado, se relee y se intenta otra vez.
    let msg = m;
    if (!m.ok && m.error === "sin-clave" && m.cuenta) { await centralDe(m.cuenta); msg = dc.leer(trama, (c) => centrales.get(String(c).toUpperCase())?.clave || null); }

    if (!msg.ok) {
        const r = msg.respuesta === "DUH" ? dc.duh(msg) : dc.nak();
        const c = msg.cuenta ? await centralDe(msg.cuenta) : null;
        if (puedoAnotar(ip)) await registrar({ centralId: c?.id || null, cuenta: msg.cuenta || null, ip, transporte, idMensaje: msg.id || null, cifrado: !!msg.cifrado, seq: msg.seq ?? null, crudo, respuesta: msg.respuesta, error: msg.error });
        log(`${ip}/${transporte}: ${msg.respuesta} (${msg.error})${msg.cuenta ? ` cuenta ${msg.cuenta}` : ""}`);
        return r;
    }
    if (["ACK", "NAK", "DUH"].includes(msg.id)) return null; // una respuesta no se contesta

    const central = await centralDe(msg.cuenta);
    const rechazo = async (error, respuesta = "NAK") => {
        if (puedoAnotar(ip)) await registrar({ centralId: central?.id || null, cuenta: msg.cuenta, ip, transporte, idMensaje: msg.id, cifrado: msg.cifrado, seq: msg.seq, crudo, datos: central ? msg.datos : null, horaCentral: msg.hora, respuesta, error });
        log(`${ip}/${transporte}: ${respuesta} (${error}) cuenta ${msg.cuenta}`);
        return respuesta === "DUH" ? dc.duh(msg) : dc.nak();
    };
    if (!central) return rechazo("cuenta-desconocida");
    if (central.clave && !msg.cifrado && !central.lanVpn) return rechazo("sin-cifrar");
    if (!dc.enVentana(msg, VENTANA_SEG)) return rechazo("hora-fuera-de-ventana");

    const respuesta = dc.ack(msg, { clave: central.clave, modoClave: msg.modoClave });
    const clave = `${msg.cuenta}:${msg.seq}:${msg.hora ? msg.hora.getTime() : crudo}`;
    const ahora = new Date();
    if (repetidos.has(clave)) { log(`${ip}: repetido cuenta ${msg.cuenta} seq ${msg.seq} → ACK sin evento`); return respuesta; }
    repetidos.set(clave, Date.now());

    // La central está viva.
    prisma.centralAlarma.update({ where: { id: central.id }, data: { estado: "EN_LINEA", ultimoMensajeAt: ahora, ipOrigen: ip, transporte, ...(msg.modoClave && msg.modoClave !== central.modoClave ? { modoClave: msg.modoClave } : {}) } })
        .then(() => { if (msg.modoClave) central.modoClave = msg.modoClave; }).catch(() => { });

    const eventos = cod.traducir(msg);
    const guardado = await registrar({ centralId: central.id, cuenta: msg.cuenta, ip, transporte, idMensaje: msg.id, cifrado: msg.cifrado, seq: msg.seq, crudo, datos: msg.datos, horaCentral: msg.hora, respuesta: "ACK", eventos: eventos.length ? eventos : undefined });
    if (eventos.length) log(`${central.nombre}: ${eventos.map((e) => `${e.codigo} ${e.texto}${e.zona != null ? ` z${e.zona}` : ""}`).join(" · ")}`);
    // Lo que pasa después (zonas, alarma, fotos) no demora el ACK.
    setImmediate(() => despues(central, msg, eventos, guardado?.id || null).catch((e) => log("después del ACK:", e.message)));
    return respuesta;
}

async function despues(central, msg, eventos, mensajeId) {
    for (const e of eventos) {
        let zona = null;
        if (e.zona != null && e.zona > 0 && e.zona < 100000) {
            // Una zona que la central no tenía cargada se crea sola (sin nombre: «Zona 7»).
            zona = await prisma.zonaCentral.upsert({ where: { centralId_zona: { centralId: central.id, zona: e.zona } }, update: {}, create: { centralId: central.id, zona: e.zona, particion: e.particion ?? null } }).catch(() => null);
        }
        if (e.categoria !== "ALARMA") continue;
        const rotuloZona = zona ? (zona.nombre ? `Zona ${zona.zona} · ${zona.nombre}` : `Zona ${zona.zona}`) : e.particion != null ? `Partición ${e.particion}` : null;
        const camaras = zona?.camaras || [];
        const det = await prisma.detection.create({
            data: {
                deviceId: central.deviceId, type: "CENTRAL", eventType: e.tipo, label: rotuloZona || e.texto, timestamp: new Date(),
                details: JSON.stringify({ central: central.nombre, cuenta: msg.cuenta, codigo: e.codigo, texto: e.texto, zona: e.zona ?? null, particion: e.particion ?? null, usuario: e.usuario ?? null, areaId: zona?.areaId || null, camaras, prueba: central.prueba || undefined }),
            },
        });
        if (mensajeId) prisma.mensajeCentral.update({ where: { id: mensajeId }, data: { detectionId: det.id } }).catch(() => { });
        const nombre = `${central.nombre}${rotuloZona ? ` · ${rotuloZona}` : ""}`;
        emitir("general_detection", { id: det.id, deviceId: central.deviceId, deviceName: nombre, type: "CENTRAL", eventType: e.tipo, label: `${TIPO_ROTULO[e.tipo] || e.texto}${rotuloZona ? ` · ${rotuloZona}` : ""}`, timestamp: det.timestamp, camaras });
        // La foto: un cuadro de cada cámara de la zona; la primera es la de la ficha.
        const fotos = [];
        for (let i = 0; i < Math.min(camaras.length, 4); i++) { const p = await fotoDe(camaras[i], `${det.id}${i ? `-${i}` : ""}.jpg`); if (p) fotos.push({ camara: camaras[i], foto: p }); }
        if (fotos.length) {
            await prisma.detection.update({ where: { id: det.id }, data: { snapshotPath: fotos[0].foto, details: JSON.stringify({ ...JSON.parse(det.details || "{}"), fotos }) } }).catch(() => { });
            emitir("detection_snapshot", { id: det.id, snapshotPath: fotos[0].foto });
        }
        // Una central de prueba (el simulador) no dispara reglas: no le llega nada a la guardia.
        if (!central.prueba) {
            avisarPorReglas({ modulo: "INTRUSION", evento: "CENTRAL", deviceId: central.deviceId, deviceName: nombre, clase: null, snapshotPath: fotos[0]?.foto || null, extra: { detectionId: det.id, eventType: e.tipo } });
        }
    }
}

// ── Red ──────────────────────────────────────────────────────────────────────────────────────
const porIp = new Map();
const tcp = net.createServer((s) => {
    const ip = String(s.remoteAddress || "").replace(/^::ffff:/, "");
    const n = (porIp.get(ip) || 0) + 1;
    if (n > CONEXIONES_POR_IP) { s.destroy(); return; }
    porIp.set(ip, n);
    s.setTimeout(INACTIVO_MS, () => s.destroy());
    let resto = "";
    let cola = Promise.resolve();
    s.on("data", (b) => {
        const { tramas, resto: r } = dc.separar(resto + b.toString("latin1"));
        resto = r;
        if (resto.length > dc.LARGO_MAX * 2) { s.destroy(); return; }
        // En orden: la central espera el ACK de cada una antes de mandar la siguiente.
        for (const t of tramas) cola = cola.then(() => procesar(t, ip, "tcp")).then((resp) => { if (resp && !s.destroyed) s.write(resp, "latin1"); }).catch((e) => log("tcp:", e.message));
    });
    const fin = () => { const k = (porIp.get(ip) || 1) - 1; if (k <= 0) porIp.delete(ip); else porIp.set(ip, k); };
    s.once("close", fin);
    s.on("error", () => { });
});
tcp.on("error", (e) => { log("TCP:", e.message); process.exit(1); });

const udp = dgram.createSocket("udp4");
udp.on("message", (b, rinfo) => {
    if (b.length > dc.LARGO_MAX * 2) return;
    const { tramas } = dc.separar(b.toString("latin1"));
    for (const t of tramas) procesar(t, rinfo.address, "udp").then((resp) => { if (resp) udp.send(Buffer.from(resp, "latin1"), rinfo.port, rinfo.address); }).catch((e) => log("udp:", e.message));
});
udp.on("error", (e) => { log("UDP:", e.message); process.exit(1); });

releer().then(() => {
    tcp.listen(PUERTO, "0.0.0.0", () => log(`escuchando TCP ${PUERTO}`));
    udp.bind(PUERTO, "0.0.0.0", () => log(`escuchando UDP ${PUERTO} · ${centrales.size} centrales dadas de alta`));
    setInterval(releer, RELEER_MS).unref();
});

const cerrar = () => { try { tcp.close(); udp.close(); } catch { } prisma.$disconnect().finally(() => process.exit(0)); };
process.on("SIGINT", cerrar); process.on("SIGTERM", cerrar);
module.exports = { procesar };
