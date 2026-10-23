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
const cms = require("./lib-cms-salida");
const { descifrar } = require("./lib-cifrado-datos");
const camarasCentral = require("./lib-centrales-camaras");

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
/**
 * La salida a CMS de un receptor (IPC10 de Paradox, Sur-Gard): otro puerto, sólo TCP, y sólo desde
 * la red local. No lleva cifrado ni hora (el formato no los tiene), por eso no se abre a internet:
 * lo que entra por acá se cree porque viene de un receptor de la red, y la lista de direcciones es
 * el único control. 0 la apaga.
 */
const PUERTO_CMS = Number(process.env.ALARMAS_PUERTO_CMS ?? 10011);
const CMS_DESDE = String(process.env.ALARMAS_CMS_DESDE || "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.1/32").split(",").map((x) => x.trim()).filter(Boolean);
/** El receptor reintenta si no le llegó el ACK: la misma trama dentro de este tiempo es la misma. */
const CMS_REPETIDO_MS = 20_000;

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
    const fila = await prisma.mensajeCentral.create({ data: datos }).catch((e) => { log("no se pudo guardar el mensaje:", e.message); return null; });
    // La pestaña «Centrales» de Gestión de alarmas se actualiza con esto (sólo el aviso: los datos los pide ella).
    if (fila) emitir("central_mensaje", { id: fila.id, centralId: fila.centralId, cuenta: fila.cuenta });
    return fila;
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

/** Las cámaras con su nombre y su stream, para el aviso del socket: [{ id, nombre, stream }]. */
async function nombrarCamaras(ids) {
    if (!ids.length) return [];
    try {
        const canales = ids.map((id) => ({ id, c: camarasCentral.canalDe(id) }));
        const nvrIds = [...new Set(canales.filter((x) => x.c).map((x) => x.c.nvrId))];
        const devs = await prisma.device.findMany({ where: { id: { in: [...ids.filter((id) => !camarasCentral.canalDe(id)), ...nvrIds] } }, select: { id: true, name: true } });
        const nombre = new Map(devs.map((d) => [d.id, d.name]));
        return canales.map(({ id, c }) => ({ id, nombre: c ? `${nombre.get(c.nvrId) || "NVR"} · canal ${c.ch}` : nombre.get(id) || "Cámara", stream: camarasCentral.streamDe(id) }));
    } catch { return ids.map((id) => ({ id, nombre: "Cámara", stream: camarasCentral.streamDe(id) })); }
}

async function despues(central, msg, eventos, mensajeId) {
    for (const e of eventos) {
        let zona = null;
        if (e.zona != null && e.zona > 0 && e.zona < 100000) {
            // Una zona que la central no tenía cargada se crea sola (sin nombre: «Zona 7»).
            zona = await prisma.zonaCentral.upsert({ where: { centralId_zona: { centralId: central.id, zona: e.zona } }, update: {}, create: { centralId: central.id, zona: e.zona, particion: e.particion ?? null } }).catch(() => null);
        }
        if (e.categoria !== "ALARMA") continue;
        // Gestión apagada: el mensaje ya quedó registrado; sólo sale el aviso de las reglas, sin alarma para tratar.
        if (!gestionOn) {
            if (!central.prueba) avisarPorReglas({ modulo: "INTRUSION", evento: "CENTRAL", deviceId: central.deviceId, deviceName: `${central.nombre}${zona ? ` · Zona ${zona.zona}${zona.nombre ? ` · ${zona.nombre}` : ""}` : ""}`, clase: null, snapshotPath: null, extra: { eventType: e.tipo } });
            continue;
        }
        const rotuloZona = zona ? (zona.nombre ? `Zona ${zona.zona} · ${zona.nombre}` : `Zona ${zona.zona}`) : e.particion != null ? `Partición ${e.particion}` : null;
        // Las cámaras de la verificación: las de la zona, si no las de su área, si no las del abonado
        // (lib-centrales-camaras.js, openspec alarmas-como-funciones).
        const ver = await camarasCentral.camarasDeZona(prisma, central.id, zona ? zona.zona : null).catch(() => ({ ids: zona?.camaras || [], origen: "zona" }));
        const camaras = ver.ids;
        const det = await prisma.detection.create({
            data: {
                deviceId: central.deviceId, type: "CENTRAL", eventType: e.tipo, label: rotuloZona || e.texto, timestamp: new Date(),
                details: JSON.stringify({ central: central.nombre, cuenta: msg.cuenta, codigo: e.codigo, texto: e.texto, zona: e.zona ?? null, particion: e.particion ?? null, usuario: e.usuario ?? null, areaId: zona?.areaId || null, camaras, prueba: central.prueba || undefined }),
            },
        });
        if (mensajeId) prisma.mensajeCentral.update({ where: { id: mensajeId }, data: { detectionId: det.id } }).catch(() => { });
        const nombre = `${central.nombre}${rotuloZona ? ` · ${rotuloZona}` : ""}`;
        // El aviso lleva las cámaras con nombre y stream: la pared abre el video con esto, sin esperar su consulta.
        emitir("general_detection", { id: det.id, deviceId: central.deviceId, deviceName: nombre, type: "CENTRAL", eventType: e.tipo, label: `${TIPO_ROTULO[e.tipo] || e.texto}${rotuloZona ? ` · ${rotuloZona}` : ""}`, timestamp: det.timestamp, camaras: await nombrarCamaras(camaras) });
        // La foto: un cuadro de cada cámara de la zona; la primera es la de la ficha.
        const fotos = [];
        for (let i = 0; i < Math.min(camaras.length, 4); i++) { const p = await fotoDe(camaras[i], `${det.id}${i ? `-${i}` : ""}.jpg`); if (p) fotos.push({ camara: camaras[i], foto: p }); }
        if (fotos.length) {
            // Releído justo antes: el panel guarda en estos mismos segundos el procedimiento del evento.
            const ahora = await prisma.detection.findUnique({ where: { id: det.id }, select: { details: true } }).catch(() => null);
            let previo = {}; try { previo = JSON.parse((ahora && ahora.details) || det.details || "{}") || {}; } catch { }
            await prisma.detection.update({ where: { id: det.id }, data: { snapshotPath: fotos[0].foto, details: JSON.stringify({ ...previo, fotos }) } }).catch(() => { });
            emitir("detection_snapshot", { id: det.id, snapshotPath: fotos[0].foto });
        }
        // Una central de prueba (el simulador) no dispara reglas: no le llega nada a la guardia.
        if (!central.prueba) {
            avisarPorReglas({ modulo: "INTRUSION", evento: "CENTRAL", deviceId: central.deviceId, deviceName: nombre, clase: null, snapshotPath: fotos[0]?.foto || null, extra: { detectionId: det.id, eventType: e.tipo } });
        }
    }
}

// ── Salida a CMS (IPC10 de Paradox, Sur-Gard) ─────────────────────────────────────────────────
function ipEn(ip, cidr) {
    const [red, bits = "32"] = cidr.split("/");
    const n = (x) => x.split(".").reduce((a, o) => (a << 8) + (Number(o) & 255), 0) >>> 0;
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !/^\d+\.\d+\.\d+\.\d+$/.test(red)) return false;
    const b = Number(bits); const mascara = b === 0 ? 0 : (~0 << (32 - b)) >>> 0;
    return (n(ip) & mascara) === (n(red) & mascara);
}
const cmsPermitida = (ip) => CMS_DESDE.some((c) => ipEn(ip, c));

/**
 * Una trama del receptor. Siempre se contesta ACK — también a una cuenta que no está dada de alta
 * o a una trama ilegible —, porque el receptor no manda el evento siguiente hasta que se le confirma
 * el anterior: un NAK lo dejaría reintentando el mismo para siempre y trabaría a todas las demás
 * centrales detrás. Lo que no se pudo usar queda anotado con su error y la trama cruda.
 */
async function procesarCms(trama, ip) {
    const crudo = String(trama).replace(/[\x00-\x1f]/g, " ").trim().slice(0, 500);
    const m = cms.leer(trama);
    if (m.tipo === "vacia" || m.tipo === "vivo") return cms.ACK;
    if (m.tipo === "ilegible") {
        if (puedoAnotar(ip)) await registrar({ centralId: null, cuenta: null, ip, transporte: "cms", idMensaje: "CMS", cifrado: false, crudo, respuesta: "ACK", error: m.error || "forma" });
        log(`${ip}/cms: trama ilegible, se confirma igual: ${JSON.stringify(crudo)}`);
        return cms.ACK;
    }
    const central = await centralDe(m.cuenta);
    if (!central) {
        if (puedoAnotar(ip)) await registrar({ centralId: null, cuenta: m.cuenta, ip, transporte: "cms", idMensaje: "ADM-CID", cifrado: false, crudo, datos: m.datos, respuesta: "ACK", error: "cuenta-desconocida" });
        log(`${ip}/cms: cuenta ${m.cuenta} no dada de alta (${m.datos}) → ACK sin evento`);
        return cms.ACK;
    }
    const clave = `cms:${m.cuenta}:${crudo}`;
    if (Date.now() - (repetidos.get(clave) || 0) < CMS_REPETIDO_MS) { log(`${ip}/cms: repetido cuenta ${m.cuenta} → ACK sin evento`); return cms.ACK; }
    repetidos.set(clave, Date.now());

    prisma.centralAlarma.update({ where: { id: central.id }, data: { estado: "EN_LINEA", ultimoMensajeAt: new Date(), ipOrigen: ip, transporte: "cms" } }).catch(() => { });
    const msg = { id: "ADM-CID", cuenta: m.cuenta, datos: m.datos, cifrado: false, seq: null, hora: null };
    const eventos = cod.traducir(msg);
    const guardado = await registrar({ centralId: central.id, cuenta: m.cuenta, ip, transporte: "cms", idMensaje: "ADM-CID", cifrado: false, crudo, datos: m.datos, respuesta: "ACK", eventos: eventos.length ? eventos : undefined });
    if (eventos.length) log(`${central.nombre} (cms): ${eventos.map((e) => `${e.codigo} ${e.texto}${e.zona != null ? ` z${e.zona}` : ""}`).join(" · ")}`);
    setImmediate(() => despues(central, msg, eventos, guardado?.id || null).catch((e) => log("después del ACK:", e.message)));
    return cms.ACK;
}

/** Las conexiones abiertas: al apagar la recepción se cortan todas, no sólo se deja de aceptar nuevas. */
const abiertas = new Set();
const tcpCms = net.createServer((s) => {
    abiertas.add(s); s.once("close", () => abiertas.delete(s));
    const ip = String(s.remoteAddress || "").replace(/^::ffff:/, "");
    if (!cmsPermitida(ip)) { log(`cms: conexión de ${ip} rechazada (no está en ALARMAS_CMS_DESDE)`); s.destroy(); return; }
    const n = (porIp.get(`cms:${ip}`) || 0) + 1;
    if (n > CONEXIONES_POR_IP) { s.destroy(); return; }
    porIp.set(`cms:${ip}`, n);
    log(`cms: se conectó ${ip}`);
    s.setTimeout(INACTIVO_MS, () => s.destroy());
    let resto = "";
    let cola = Promise.resolve();
    s.on("data", (b) => {
        const { tramas, resto: r } = cms.separar(resto + b.toString("latin1"));
        resto = r;
        for (const t of tramas) cola = cola.then(() => procesarCms(t, ip)).then((resp) => { if (resp && !s.destroyed) s.write(resp, "latin1"); }).catch((e) => log("cms:", e.message));
    });
    s.once("close", () => { const k = (porIp.get(`cms:${ip}`) || 1) - 1; if (k <= 0) porIp.delete(`cms:${ip}`); else porIp.set(`cms:${ip}`, k); log(`cms: se desconectó ${ip}`); });
    s.on("error", () => { });
});
tcpCms.on("error", (e) => { log("TCP CMS:", e.message); process.exit(1); });

// ── Red ──────────────────────────────────────────────────────────────────────────────────────
const porIp = new Map();
const tcp = net.createServer((s) => {
    abiertas.add(s); s.once("close", () => abiertas.delete(s));
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

// UDP: un socket cerrado no se vuelve a abrir, así que se crea uno nuevo cada vez que se prende.
let udp = null;
function nuevoUdp() {
    const u = dgram.createSocket("udp4");
    u.on("message", (b, rinfo) => {
        if (b.length > dc.LARGO_MAX * 2) return;
        const { tramas } = dc.separar(b.toString("latin1"));
        for (const t of tramas) procesar(t, rinfo.address, "udp").then((resp) => { if (resp) u.send(Buffer.from(resp, "latin1"), rinfo.port, rinfo.address); }).catch((e) => log("udp:", e.message));
    });
    u.on("error", (e) => { log("UDP:", e.message); process.exit(1); });
    return u;
}

// ── Funciones de la instalación (openspec alarmas-como-funciones) ─────────────────────────────
// Recepción apagada: los puertos se CIERRAN (no se contesta NAK: la central reintentaría el mismo
// evento para siempre y trabaría la cola; con el puerto cerrado registra falla de comunicación, que
// es la verdad). Gestión apagada: se registra y se avisa, pero no se crean alarmas para tratar.
// Se sondea Setting: el panel no tiene cómo avisarle a este proceso sin pasar por server.js.
const SONDEO_FUNCIONES_MS = 15_000;
let escuchando = false;
/** Gestión de alarmas efectiva (prendida y con la recepción prendida). Antes de leerla, prendida: se lee antes de abrir. */
let gestionOn = true;
async function leerFunciones() {
    const filas = await prisma.setting.findMany({ where: { key: { in: ["FUNC_ALARMAS_RECEPCION", "FUNC_ALARMAS_GESTION"] } }, select: { key: true, value: true } });
    const v = (k) => filas.find((f) => f.key === k)?.value === "true";   // sin fila: apagada (su defecto)
    return { recepcion: v("FUNC_ALARMAS_RECEPCION"), gestion: v("FUNC_ALARMAS_RECEPCION") && v("FUNC_ALARMAS_GESTION") };
}
function abrirPuertos() {
    if (escuchando) return;
    escuchando = true;
    udp = nuevoUdp();
    tcp.listen(PUERTO, "0.0.0.0", () => log(`escuchando TCP ${PUERTO}`));
    udp.bind(PUERTO, "0.0.0.0", () => log(`escuchando UDP ${PUERTO} · ${centrales.size} centrales dadas de alta`));
    if (PUERTO_CMS) tcpCms.listen(PUERTO_CMS, "0.0.0.0", () => log(`escuchando TCP ${PUERTO_CMS} (salida a CMS de receptores: IPC10, Sur-Gard) desde ${CMS_DESDE.join(", ")}`));
}
function cerrarPuertos() {
    if (!escuchando) return;
    escuchando = false;
    try { tcp.close(); } catch { }
    try { if (PUERTO_CMS) tcpCms.close(); } catch { }
    try { udp?.close(); } catch { }
    udp = null;
    for (const s of abiertas) s.destroy();
    log("recepción de alarmas apagada en Ajustes → Modos: puertos cerrados");
}
async function aplicarFunciones() {
    try {
        const f = await leerFunciones();
        if (f.gestion !== gestionOn) log(`gestión de alarmas ${f.gestion ? "prendida" : "apagada: se registra y se avisa, sin alarmas para tratar"}`);
        gestionOn = f.gestion;
        if (f.recepcion) abrirPuertos(); else cerrarPuertos();
    } catch (e) {
        // Si la base no contesta se queda como estaba: nunca se cierra el puerto por un hipo de consulta.
        log("no se pudieron leer las funciones:", e.message);
    }
}

releer().then(async () => {
    await aplicarFunciones();
    if (!escuchando) log("recepción de alarmas apagada en Ajustes → Modos: no se abren los puertos");
    setInterval(releer, RELEER_MS).unref();
    setInterval(aplicarFunciones, SONDEO_FUNCIONES_MS).unref();
});

const cerrar = () => { try { tcp.close(); udp?.close(); tcpCms.close(); } catch { } prisma.$disconnect().finally(() => process.exit(0)); };
process.on("SIGINT", cerrar); process.on("SIGTERM", cerrar);
module.exports = { procesar, procesarCms };
