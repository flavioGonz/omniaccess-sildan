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

async function alPresentarse(imei, ip) {
    await prisma.gpsEquipo.upsert({
        where: { imei },
        create: { imei, ultimaIp: ip, ultimoLatido: new Date() },
        update: { ultimaIp: ip, ultimoLatido: new Date() },
    });
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
    await prisma.gpsEquipo.update({
        where: { imei },
        data: {
            lat: p.lat, lon: p.lon, velocidad: p.velocidad, rumbo: p.rumbo, cuando: p.fecha, ultimoLatido: new Date(),
            ...(m.encendido !== undefined ? { encendido: m.encendido } : {}),
        },
    }).catch(() => {});
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
                    await alLatido(imei, m.estado);
                } else if (m.tipo === "posicion" || m.tipo === "alarma") {
                    const guardada = await alPosicion(imei, m);
                    if (m.tipo === "alarma") log(imei, "ALARMA:", g.nombreAlarma(m.alarma));
                    else if (!guardada) log(imei, "posición sin satélites, no se guarda");
                } else if (m.tipo === "respuesta") {
                    alResponder(imei, m);
                    continue;
                } else if (m.tipo === "info") {
                    const data = { ...(m.voltaje !== undefined ? { voltaje: m.voltaje } : {}), ...(m.iccid ? { iccid: m.iccid } : {}) };
                    if (Object.keys(data).length) await prisma.gpsEquipo.update({ where: { imei }, data }).catch(() => {});
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
