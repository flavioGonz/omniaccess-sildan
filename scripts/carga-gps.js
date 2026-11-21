#!/usr/bin/env node
/**
 * Prueba de carga del receptor de GPS: N rastreadores de mentira hablando GT06 de verdad.
 *
 *   node scripts/carga-gps.js --equipos 200 --segundos 120 --cada 10
 *
 * Por qué existe (21/11): todo lo que se sabía del receptor salía de UN equipo. «¿Aguanta
 * doscientos?» no se contesta razonando: se contesta conectando doscientos.
 *
 * Qué hace:
 *  · Da de alta N rastreadores de prueba (IMEI 3599990000NNNNN, equipo «carga-prueba»). Tienen que
 *    estar aceptados: a uno sin aceptar el receptor no le guarda el historial ni le mira las
 *    geocercas, y entonces no se estaría midiendo el trabajo real.
 *  · Cada uno se conecta, hace su login y manda una posición cada `--cada` segundos (andando a
 *    40 km/h, en el medio del Río de la Plata para no cruzar ninguna geocerca de verdad) y un
 *    latido cada 30. Arrancan escalonados, como en la vida: doscientos equipos no reportan todos
 *    en el mismo milisegundo.
 *  · Mide lo que tarda el receptor en acusar cada login y cada latido —el acuse sale después de
 *    escribir en la base, así que ese tiempo ES el del receptor con su base— y, al final, cuenta
 *    en la base las posiciones que llegaron contra las que se mandaron.
 *  · Borra todo lo que creó (con `--conservar` lo deja, para mirarlo).
 *
 * Los rastreadores de prueba no se listan en Dispositivos, no abren casos y no se los declara
 * mudos al terminar (lib-gps-eventos.js, DEVICE_DE_PRUEBA). Se corre en el servidor, contra el
 * receptor que está andando: no hay un receptor «de prueba».
 */
"use strict";
require("dotenv").config({ quiet: true });
const net = require("net");
const path = require("path");
const g = require(path.join(__dirname, "..", "lib-gt06.js"));
const { DEVICE_DE_PRUEBA } = require(path.join(__dirname, "..", "lib-gps-eventos.js"));

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d; };
const N = Math.min(Math.max(Number(arg("equipos", 50)), 1), 2000);
const SEGUNDOS = Math.min(Math.max(Number(arg("segundos", 60)), 10), 1800);
const CADA = Math.min(Math.max(Number(arg("cada", 10)), 1), 300);
const HOST = arg("host", "127.0.0.1"), PUERTO = Number(arg("puerto", process.env.GPS_PUERTO || 1341));
const CONSERVAR = process.argv.includes("--conservar");
const PREFIJO = "3599990000";
const imeiDe = (i) => PREFIJO + String(i).padStart(5, "0");

/** Una trama corta con su CRC. */
function trama(proto, datos, serie) {
    const cuerpo = Buffer.concat([Buffer.from([datos.length + 5, proto]), datos, Buffer.from([serie >> 8, serie & 0xff])]);
    const c = g.crcItu(cuerpo);
    return Buffer.concat([Buffer.from([0x78, 0x78]), cuerpo, Buffer.from([c >> 8, c & 0xff, 0x0d, 0x0a])]);
}
const login = (imei, serie) => trama(0x01, Buffer.from(("0" + imei), "hex"), serie);
const latido = (serie) => trama(0x13, Buffer.from([0x46, 0x06, 0x04, 0x00, 0x02]), serie);   // ACC encendido, con fix, batería llena, señal fuerte
/** Una posición GT06N (0x22): fecha, 10 satélites, lat/lon del sur y del oeste, velocidad, rumbo y ACC. */
function posicion(lat, lon, vel, rumbo, serie, cuando) {
    const d = Buffer.alloc(29);
    d[0] = cuando.getUTCFullYear() - 2000; d[1] = cuando.getUTCMonth() + 1; d[2] = cuando.getUTCDate();
    d[3] = cuando.getUTCHours(); d[4] = cuando.getUTCMinutes(); d[5] = cuando.getUTCSeconds();
    d[6] = 0xca;                                                    // 12 bytes de info de GPS, 10 satélites
    d.writeUInt32BE(Math.round(Math.abs(lat) * 60 * 30000), 7);
    d.writeUInt32BE(Math.round(Math.abs(lon) * 60 * 30000), 11);
    d[15] = vel;
    d.writeUInt16BE(0x1000 | (lat >= 0 ? 0x0400 : 0) | (lon < 0 ? 0x0800 : 0) | (rumbo & 0x03ff), 16);   // con fix, sur, oeste
    d.writeUInt16BE(748, 18); d[20] = 1; d.writeUInt16BE(1, 21); d[23] = 0; d.writeUInt16BE(1, 24);    // una celda cualquiera
    d[26] = 1;                                                      // ACC
    return trama(0x22, d, serie);
}

const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);

(async () => {
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    const imeis = Array.from({ length: N }, (_, i) => imeiDe(i));
    const limpiar = async () => {
        await prisma.gpsPosicion.deleteMany({ where: { imei: { startsWith: PREFIJO } } });
        await prisma.gpsEvento.deleteMany({ where: { imei: { startsWith: PREFIJO } } });
        await prisma.gpsEquipo.deleteMany({ where: { imei: { startsWith: PREFIJO } } });
    };
    await limpiar();                                                // por si una corrida anterior quedó a medias
    await prisma.gpsEquipo.createMany({ data: imeis.map((imei, i) => ({ imei, deviceId: DEVICE_DE_PRUEBA, nombre: `Carga ${i + 1}` })) });

    const acuses = [], logins = [];
    let mandadas = 0, caidas = 0, errores = 0, conectados = 0;
    const fin = Date.now() + SEGUNDOS * 1000;
    console.log(`${N} rastreadores contra ${HOST}:${PUERTO}, ${SEGUNDOS} s, una posición cada ${CADA} s (≈ ${(N / CADA).toFixed(1)} posiciones por segundo)`);

    await Promise.all(imeis.map((imei, i) => new Promise((listo) => {
        const arranque = (i / N) * CADA * 1000;                     // escalonados dentro de un ciclo
        setTimeout(() => {
            const s = net.connect(PUERTO, HOST);
            let serie = 1, buf = Buffer.alloc(0), relojes = [], cerrado = false;
            const espera = new Map();                               // serie → cuándo se mandó
            let lat = -35.5 - (i % 40) * 0.01, lon = -56.0 - Math.floor(i / 40) * 0.02;
            const cerrar = () => { if (cerrado) return; cerrado = true; relojes.forEach(clearInterval); s.destroy(); listo(); };
            s.on("connect", () => { conectados++; espera.set(serie, { t: process.hrtime.bigint(), login: true }); s.write(login(imei, serie++)); });
            s.on("data", (trozo) => {
                buf = Buffer.concat([buf, trozo]);
                const { tramas, resto } = g.partir(buf); buf = resto;
                for (const t of tramas) {
                    const sr = t.readUInt16BE(t.length - 6), e = espera.get(sr);
                    if (!e) continue;
                    espera.delete(sr);
                    const ms = Number(process.hrtime.bigint() - e.t) / 1e6;
                    if (e.login) {
                        logins.push(ms);
                        /* Ya aceptado: empieza a reportar. */
                        relojes.push(setInterval(() => {
                            if (Date.now() >= fin) return cerrar();
                            lat += (40 / 3.6 * CADA) / 111_195;         // 40 km/h hacia el norte
                            s.write(posicion(lat, lon, 40, 0, serie = (serie + 1) & 0xffff, new Date())); mandadas++;
                        }, CADA * 1000));
                        relojes.push(setInterval(() => { serie = (serie + 1) & 0xffff; espera.set(serie, { t: process.hrtime.bigint() }); s.write(latido(serie)); }, 30_000 + (i % 30) * 100));
                        /* Un latido enseguida, para tener medida aunque la prueba dure poco. */
                        serie = (serie + 1) & 0xffff; espera.set(serie, { t: process.hrtime.bigint() }); s.write(latido(serie));
                    } else acuses.push(ms);
                }
            });
            s.on("error", () => { errores++; });
            s.on("close", () => { if (!cerrado && Date.now() < fin) caidas++; cerrar(); });
            setTimeout(cerrar, Math.max(0, fin - Date.now()) + 1500);
        }, arranque);
    })));

    await new Promise((r) => setTimeout(r, 3000));                  // que el receptor termine de escribir lo último
    const guardadas = await prisma.gpsPosicion.count({ where: { imei: { startsWith: PREFIJO } } });
    /* La demora de punta a punta, medida por la base: cuándo dice el «equipo» que tomó la posición
       (al segundo) contra cuándo quedó escrita. Incluye hasta un segundo de redondeo. */
    const d = await prisma.$queryRawUnsafe(`select percentile_cont(0.5) within group (order by extract(epoch from llego-cuando)) as p50, percentile_cont(0.99) within group (order by extract(epoch from llego-cuando)) as p99, max(extract(epoch from llego-cuando)) as max from "GpsPosicion" where imei like '${PREFIJO}%'`).catch(() => [{}]);
    let salud = null;
    try { salud = await (await fetch(`http://127.0.0.1:${process.env.GPS_PUERTO_CONTROL || 10013}/salud`, { signal: AbortSignal.timeout(3000) })).json(); } catch { /* otro host: sin dato */ }
    acuses.sort((a, b) => a - b); logins.sort((a, b) => a - b);
    const ms = (x) => `${x.toFixed(x < 10 ? 1 : 0)} ms`;
    console.log(`\nconectaron ${conectados} de ${N} · se presentaron ${logins.length} · caídas en medio ${caidas} · errores de red ${errores}`);
    console.log(`login: mediana ${ms(pct(logins, 0.5))}, p99 ${ms(pct(logins, 0.99))}, peor ${ms(logins[logins.length - 1] || 0)}`);
    console.log(`latido → acuse (${acuses.length}): mediana ${ms(pct(acuses, 0.5))}, p95 ${ms(pct(acuses, 0.95))}, p99 ${ms(pct(acuses, 0.99))}, peor ${ms(acuses[acuses.length - 1] || 0)}`);
    console.log(`posiciones: mandadas ${mandadas}, guardadas ${guardadas}${mandadas ? ` (${((guardadas / mandadas) * 100).toFixed(1)} %)` : ""}`);
    if (d[0] && d[0].p50 != null) console.log(`posición tomada → escrita en la base (con hasta 1 s de redondeo): mediana ${Number(d[0].p50).toFixed(2)} s, p99 ${Number(d[0].p99).toFixed(2)} s, peor ${Number(d[0].max).toFixed(2)} s`);
    if (salud) console.log(`el receptor dice: ${salud.conexiones} conexiones, ${salud.enLinea} en línea, ${salud.rechazados} rechazados, ${salud.castigadas} IP castigadas`);
    if (!CONSERVAR) { await limpiar(); console.log("lo de la prueba quedó borrado"); }
    await prisma.$disconnect();
    process.exit(0);
})().catch((e) => { console.error("la prueba falló:", e.message); process.exit(1); });
