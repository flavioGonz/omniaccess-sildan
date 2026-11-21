#!/usr/bin/env node
/**
 * Receptor de rastreadores GPS (protocolo GT06 / Concox y clones).
 *
 * Proceso propio, como alarm-receiver.js, y por la misma razón: un GPS no llama a una URL, abre
 * un TCP y lo deja abierto. Escucha en GPS_PUERTO (1341) y por cada trama:
 *
 *   · login     → anota el equipo (se crea solo la primera vez) y le contesta el acuse. SIN ESE
 *                 ACUSE EL EQUIPO NO PASA DE AHÍ: medido el 20/11, el de Nico mandó el mismo
 *                 login cada 30 segundos durante horas y por SMS decía «GPRS: Link Down».
 *   · latido    → batería, señal y motor encendido; acuse.
 *   · posición  → una fila en GpsPosicion y lo último en GpsEquipo. Sólo las que traen
 *                 satélites: una posición «sin fix» es la última que el equipo supo, repetida, y
 *                 guardarla dibuja un auto quieto donde ya no está.
 *   · alarma    → lo mismo, con su código; acuse.
 *
 * El puerto está abierto a internet (el GPS sale por la red celular, con IP que cambia), así que
 * acá llega de todo. Tres defensas: lo que no es una trama válida se ignora, una conexión que no
 * se presenta en un minuto se corta, y nada de lo que entra se confía — el IMEI identifica, no
 * autoriza: un equipo desconocido se anota, pero no hace nada más hasta que alguien lo ate.
 *
 * Las tramas se anotan en crudo en el log mientras GPS_CRUDO no sea "0": hasta ver bastantes
 * tramas reales de posición, el hex es la única forma de arreglar el decodificador sin adivinar.
 */
"use strict";
require("dotenv").config({ quiet: true });
const net = require("net");
const { PrismaClient } = require("@prisma/client");
const g = require("./lib-gt06");
const evs = require("./lib-gps-eventos");

const prisma = new PrismaClient();
const PUERTO = Number(process.env.GPS_PUERTO || 1341);
const CRUDO = process.env.GPS_CRUDO !== "0";
/** Sin presentarse en este tiempo, se corta: un escáner no manda un login. */
const SIN_LOGIN_MS = 60_000;
/** Un equipo que no dice nada en este tiempo se cayó sin avisar (túnel, sin señal). */
const MUDO_MS = 10 * 60_000;
/** Tope de lo que se junta sin encontrar una trama: lo demás es basura. */
const BASURA_MAX = 4096;

const log = (...a) => console.log(new Date().toISOString(), ...a);
const enLinea = new Map();   // imei → socket

/**
 * Los comandos al equipo. La aplicación web no tiene el socket del rastreador —lo tiene este
 * proceso—, así que le pide el envío por una puertita HTTP que SÓLO escucha en 127.0.0.1: desde
 * afuera del servidor no existe. Cada comando lleva una marca; el equipo la devuelve en su
 * respuesta y con eso se sabe a quién contestarle.
 */
const PUERTO_CONTROL = Number(process.env.GPS_PUERTO_CONTROL || 10013);
const ESPERA_RESPUESTA_MS = 20_000;
const esperando = new Map();   // marca → { resolver, reloj }
let marcaSig = (Date.now() & 0x7fffffff) || 1, serieSig = 1;

function mandarComando(imei, texto, conIdioma = true) {
    return new Promise((resolver) => {
        const s = enLinea.get(imei);
        if (!s) return resolver({ ok: false, error: "El rastreador no está en línea." });
        const marca = marcaSig = (marcaSig + 1) & 0x7fffffff;
        const reloj = setTimeout(() => { esperando.delete(marca); resolver({ ok: false, error: "El rastreador no contestó a tiempo." }); }, ESPERA_RESPUESTA_MS);
        esperando.set(marca, { resolver, reloj, imei });
        const t = g.comando(texto, serieSig = (serieSig + 1) & 0xffff, marca, conIdioma);
        log(imei, "COMANDO →", texto, t.toString("hex"));
        s.write(t);
    });
}

function alResponder(imei, m) {
    log(imei, "RESPUESTA ←", JSON.stringify(m.texto));
    /* Por la marca, y si el equipo no la devuelve bien, al único comando que ese equipo tiene
       pendiente: no perder una respuesta por un detalle del clon. */
    let e = esperando.get(m.marca);
    let clave = m.marca;
    if (!e) for (const [k, v] of esperando) if (v.imei === imei) { e = v; clave = k; break; }
    if (!e) return;
    clearTimeout(e.reloj); esperando.delete(clave);
    e.resolver({ ok: true, respuesta: m.texto });
}

require("http").createServer((req, res) => {
    const fin = (c, o) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.method === "GET" && req.url === "/enlinea") return fin(200, { imeis: [...enLinea.keys()] });
    if (req.method !== "POST" || req.url !== "/comando") return fin(404, { error: "no existe" });
    let cuerpo = "";
    req.on("data", (c) => { cuerpo += c; if (cuerpo.length > 2000) req.destroy(); });
    req.on("end", async () => {
        try {
            const { imei, texto, sinIdioma } = JSON.parse(cuerpo || "{}");
            if (!imei || !texto || !/^[\x20-\x7e]{1,80}$/.test(texto)) return fin(400, { ok: false, error: "Falta el equipo o el comando." });
            fin(200, await mandarComando(String(imei), String(texto), !sinIdioma));
        } catch { fin(400, { ok: false, error: "Pedido mal formado." }); }
    });
}).listen(PUERTO_CONTROL, "127.0.0.1", () => log(`control de comandos en 127.0.0.1:${PUERTO_CONTROL}`));

/**
 * Los eventos: se guardan en GpsEvento y se pasan al motor de reglas de la aplicación, que es el
 * que sabe a quién avisarle y por dónde (el mismo camino que usa alarm-receiver.js). Si no hay
 * ninguna regla de GPS, no sale nada: el evento queda guardado y listo.
 */
const vigia = evs.nuevoVigia();
/** Lo último que se supo del motor de cada equipo, para juzgar «se mueve con el motor apagado». */
const motor = new Map();

/** Las geocercas, releídas cada medio minuto: se editan en el mapa y el receptor es otro proceso. */
let geocercas = [];
async function leerGeocercas() { try { geocercas = await prisma.gpsGeocerca.findMany({ where: { activa: true } }); } catch { /* sin base: quedan las últimas */ } }
leerGeocercas(); setInterval(leerGeocercas, 30_000).unref();

/**
 * Lo que pasa, empujado a las pantallas abiertas por el socket del servidor de eventos (el mismo
 * camino que usa alarm-receiver.js). Sin esto el mapa se enteraba preguntando cada 15 segundos:
 * el vehículo avanzaba a saltos y un cruce de geocerca no se veía hasta el próximo refresco.
 */
const WEBHOOKS = Number(process.env.WEBHOOK_PORT || 10000);
function emitir(evento, datos) {
    try {
        const cuerpo = JSON.stringify({ __event: evento, ...datos });
        const req = require("http").request({ hostname: "127.0.0.1", port: WEBHOOKS, path: "/internal/emit", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(cuerpo) }, timeout: 2000 });
        req.on("error", () => {}); req.on("timeout", () => req.destroy());
        req.write(cuerpo); req.end();
    } catch { /* un aviso al panel que no sale no puede frenar la recepción */ }
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

async function alEvento(imei, tipo, p, detalle, extra) {
    if (!tipo) return;
    log(imei, "EVENTO:", tipo, detalle || "");
    try {
        const e = await prisma.gpsEquipo.findUnique({ where: { imei } });
        /* Un equipo que se presentó solo y nadie aceptó no avisa a nadie: todavía no es de nadie. */
        if (!e || !e.deviceId) return;
        const lat = p && p.conFix ? p.lat : e.lat, lon = p && p.conFix ? p.lon : e.lon;
        await prisma.gpsEvento.create({ data: { imei, tipo, lat, lon, detalle: detalle || null } });
        if (evs.SOLO_SE_ANOTA.has(tipo)) return;
        /* A la pantalla va siempre, haya o no una regla de notificación: que no se le avise a
           nadie por Telegram no quiere decir que quien está mirando el mapa no lo tenga que ver.
           (21/11, Nico: «la geocerca no hace nada cuando el GPS entra»: lo detectaba y lo
           guardaba, pero sin regla no salía ningún aviso y el mapa no mostraba nada.) */
        emitir("gps_evento", { imei, tipo, rotulo: evs.ROTULO[tipo] || tipo, detalle: detalle || "", nombre: e.nombre || `Rastreador ${imei.slice(-6)}`, lat, lon, cuando: new Date().toISOString(), ...(extra || {}) });
        const veh = e.vehicleId ? await prisma.vehicle.findUnique({ where: { id: e.vehicleId }, select: { plate: true } }).catch(() => null) : null;
        const lugar = lat != null && lon != null ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : "";
        avisarPorReglas({
            modulo: "GPS", evento: tipo, deviceId: e.deviceId, deviceName: e.nombre || `Rastreador ${imei.slice(-6)}`,
            plate: veh ? veh.plate : null,
            extra: { detalle: detalle || "", lugar, mapa: lugar ? `https://maps.google.com/?q=${lat},${lon}` : "", imei },
        });
    } catch (err) { log(imei, "error guardando el evento:", err.message); }
}

async function alPresentarse(imei, ip) {
    await prisma.gpsEquipo.upsert({
        where: { imei },
        create: { imei, ultimaIp: ip, ultimoLatido: new Date() },
        update: { ultimaIp: ip, ultimoLatido: new Date() },
    });
    /* Se siembra lo último que se supo: reiniciar el receptor con la batería ya baja, o con el
       motor ya apagado, no es una novedad y no tiene que avisar. */
    const e = await prisma.gpsEquipo.findUnique({ where: { imei }, select: { voltaje: true, encendido: true } }).catch(() => null);
    if (e) { vigia.sembrar(imei, e.voltaje); if (e.encendido !== null) motor.set(imei, e.encendido); }
}

async function alLatido(imei, e) {
    await prisma.gpsEquipo.update({
        where: { imei },
        data: { encendido: e.encendido, bateria: e.bateria, senal: e.senal, cortado: e.cortado, ultimoLatido: new Date() },
    }).catch(() => {});
}

async function alPosicion(imei, m) {
    const p = m.gps;
    /* Sin satélites, o en el punto (0,0), no es una posición: es un equipo diciendo que no sabe. */
    if (!p || !p.conFix || !p.fecha || (p.lat === 0 && p.lon === 0)) {
        await prisma.gpsEquipo.update({ where: { imei }, data: { ultimoLatido: new Date() } }).catch(() => {});
        return false;
    }
    await prisma.gpsPosicion.create({
        data: {
            imei, cuando: p.fecha, lat: p.lat, lon: p.lon, velocidad: p.velocidad, rumbo: p.rumbo,
            satelites: p.satelites, encendido: m.encendido ?? null, alarma: m.tipo === "alarma" ? m.alarma : null,
        },
    });
    /* Con pocos satélites la posición queda GUARDADA (es el dato crudo, y dice con cuántos
       satélites llegó) pero no mueve el punto del mapa: la noche del 20/11 el auto estacionado
       mandó 364 de éstas, saltando hasta 400 metros alrededor de su lugar. */
    if (p.satelites < evs.SATS_MIN) {
        await prisma.gpsEquipo.update({ where: { imei }, data: { ultimoLatido: new Date() } }).catch(() => {});
        return "pobre";
    }
    const e = await prisma.gpsEquipo.update({
        where: { imei },
        data: {
            lat: p.lat, lon: p.lon, velocidad: p.velocidad, rumbo: p.rumbo, cuando: p.fecha, ultimoLatido: new Date(),
            ...(m.encendido !== undefined ? { encendido: m.encendido } : {}),
        },
    }).catch(() => null);
    /* Sólo los dados de alta viajan a las pantallas: uno que se presentó solo no es de nadie. */
    if (e && e.deviceId) emitir("gps_posicion", { imei, lat: p.lat, lon: p.lon, velocidad: p.velocidad, rumbo: p.rumbo, cuando: p.fecha.toISOString() });
    return true;
}

const servidor = net.createServer((s) => {
    const ip = s.remoteAddress || "?";
    let buf = Buffer.alloc(0);
    let imei = null;
    const sinLogin = setTimeout(() => { if (!imei) s.destroy(); }, SIN_LOGIN_MS);
    s.setTimeout(MUDO_MS, () => s.destroy());

    s.on("data", async (trozo) => {
        buf = Buffer.concat([buf, trozo]);
        const { tramas, resto } = g.partir(buf);
        buf = resto;
        if (!tramas.length && buf.length > BASURA_MAX) { s.destroy(); return; }

        for (const t of tramas) {
            const m = g.leer(t);
            if (!m.ok) { log(ip, "trama con CRC roto, se ignora"); continue; }
            if (CRUDO) log(imei || ip, m.tipo, t.toString("hex"));
            try {
                if (m.tipo === "login") {
                    imei = m.imei;
                    clearTimeout(sinLogin);
                    const viejo = enLinea.get(imei);
                    if (viejo && viejo !== s) viejo.destroy();   // el mismo equipo reconectó: la vieja está muerta
                    enLinea.set(imei, s);
                    await alPresentarse(imei, ip);
                    log(imei, "se presentó desde", ip);
                } else if (!imei) {
                    continue;                                     // nadie habla antes de presentarse
                } else if (m.tipo === "estado") {
                    motor.set(imei, m.estado.encendido);
                    await alLatido(imei, m.estado);
                    await alEvento(imei, evs.eventoDeAlarma(m.estado.alarma), null);
                } else if (m.tipo === "posicion" || m.tipo === "alarma") {
                    if (m.encendido !== undefined) motor.set(imei, m.encendido);
                    const guardada = await alPosicion(imei, m);
                    if (m.tipo === "alarma") { const tipoA = evs.eventoDeAlarma(m.alarma) || "GPS_OTRA"; await alEvento(imei, tipoA, m.gps, tipoA === "GPS_OTRA" ? g.nombreAlarma(m.alarma) : null); }
                    else if (!guardada) log(imei, "posición sin satélites, no se guarda");
                    /* Las geocercas y el «se mueve con el motor apagado» sólo miran posiciones
                       buenas: con las otras, un auto quieto cruza cercas y «se traslada» solo. */
                    if (m.gps && guardada === true) {
                        const sabido = motor.has(imei) ? motor.get(imei) : null;
                        const t = vigia.alMoverse(imei, { conFix: m.gps.conFix, velocidad: m.gps.velocidad, encendido: sabido });
                        if (t) await alEvento(imei, t, m.gps, `${m.gps.velocidad} km/h`);
                        for (const c of vigia.alUbicarse(imei, geocercas, m.gps)) await alEvento(imei, c.tipo, m.gps, c.geocerca.nombre, { geocercaId: c.geocerca.id });
                    }
                } else if (m.tipo === "respuesta") {
                    alResponder(imei, m);
                    continue;
                } else if (m.tipo === "info") {
                    const data = { ...(m.voltaje !== undefined ? { voltaje: m.voltaje } : {}), ...(m.iccid ? { iccid: m.iccid } : {}) };
                    if (Object.keys(data).length) await prisma.gpsEquipo.update({ where: { imei }, data }).catch(() => {});
                    if (m.voltaje !== undefined) {
                        const t = vigia.alVoltaje(imei, m.voltaje);
                        if (t) await alEvento(imei, t, null, `${m.voltaje.toFixed(1).replace(".", ",")} V`);
                    }
                    continue;
                } else if (m.tipo === "hora") {
                    s.write(g.acuseHora(m.serie));
                    continue;
                }
            } catch (e) { log(imei || ip, "error guardando:", e.message); }
            /* Lo desconocido también se acusa: el acuse genérico no hace daño y evita que un
               mensaje que no entendemos tire abajo un enlace que anda. */
            if (g.pideAcuse(m) || m.tipo === "desconocido") s.write(g.acuse(m.proto, m.serie));
        }
    });
    s.on("close", () => { clearTimeout(sinLogin); if (imei && enLinea.get(imei) === s) { enLinea.delete(imei); log(imei, "se desconectó"); } });
    s.on("error", () => {});
});

servidor.listen(PUERTO, "0.0.0.0", () => log(`gps-receiver escuchando en ${PUERTO} (GT06)`));
process.on("SIGTERM", async () => { servidor.close(); await prisma.$disconnect(); process.exit(0); });
