#!/usr/bin/env node
/**
 * Pruebas del protocolo GT06 (lib-gt06.js), sin red ni base.
 *   node scripts/probar-gt06.js
 * Las tramas de login son las que mandó de verdad el equipo de Nico el 20/11.
 */
"use strict";
const assert = require("assert");
const path = require("path");
const g = require(path.join(__dirname, "..", "lib-gt06.js"));

let ok = 0, mal = 0;
function prueba(nombre, fn) {
    try { fn(); ok++; console.log("  ✓", nombre); }
    catch (e) { mal++; console.log("  ✗", nombre, "\n     ", e.message); }
}
const H = (x) => Buffer.from(x.replace(/\s+/g, ""), "hex");

/** Arma una trama corta con su CRC: para probar lo que todavía no mandó ningún equipo. */
function trama(proto, datos, serie) {
    const cuerpo = Buffer.concat([Buffer.from([datos.length + 5, proto]), datos, Buffer.from([serie >> 8, serie & 0xff])]);
    const c = g.crcItu(cuerpo);
    return Buffer.concat([H("7878"), cuerpo, Buffer.from([c >> 8, c & 0xff, 0x0d, 0x0a])]);
}

console.log("lib-gt06");
const REALES = ["78780d0108651900757498800001bd870d0a", "78780d010865190075749880000e45700d0a",
    "78780d010865190075749880000f54f90d0a", "78780d0108651900757498800010bc8f0d0a"];

prueba("el CRC cierra en las cuatro tramas reales del equipo", () => {
    for (const h of REALES) { const b = H(h); assert.strictEqual(g.crcItu(b.subarray(2, b.length - 4)), b.readUInt16BE(b.length - 4)); }
});
prueba("el login trae el IMEI y la serie", () => {
    const m = g.leer(H(REALES[1]));
    assert.ok(m.ok); assert.strictEqual(m.tipo, "login");
    assert.strictEqual(m.imei, "865190075749880"); assert.strictEqual(m.serie, 0x0e);
    assert.ok(g.pideAcuse(m));
});
prueba("el acuse del login es el que pide el protocolo", () => {
    // El ejemplo canónico del manual de Concox: login con serie 1 → 78 78 05 01 00 01 D9 DC 0D 0A
    assert.strictEqual(g.acuse(0x01, 1).toString("hex"), "787805010001d9dc0d0a");
});
prueba("un CRC roto no se da por bueno", () => {
    const b = H(REALES[0]); b[6] ^= 0xff;
    assert.strictEqual(g.leer(b).ok, false);
});
prueba("dos tramas pegadas y una por la mitad", () => {
    const junto = Buffer.concat([H(REALES[0]), H(REALES[1]), H(REALES[2]).subarray(0, 7)]);
    const r = g.partir(junto);
    assert.strictEqual(r.tramas.length, 2); assert.strictEqual(r.resto.length, 7);
    const r2 = g.partir(Buffer.concat([r.resto, H(REALES[2]).subarray(7)]));
    assert.strictEqual(r2.tramas.length, 1); assert.strictEqual(r2.resto.length, 0);
});
prueba("la basura de un escáner antes de una trama se saltea", () => {
    const r = g.partir(Buffer.concat([Buffer.from("GET / HTTP/1.1\r\n\r\n"), H(REALES[0])]));
    assert.strictEqual(r.tramas.length, 1);
});
prueba("una posición en Montevideo queda en el hemisferio correcto", () => {
    // -34.9011, -56.1645 → en 1/30000 de minuto, sin signo; el signo va en las banderas.
    const lat = Math.round(34.9011 * 60 * 30000), lon = Math.round(56.1645 * 60 * 30000);
    const d = Buffer.alloc(26);
    Buffer.from([26, 11, 20, 13, 30, 15]).copy(d, 0);       // 2026-11-20 13:30:15 UTC
    d[6] = 0xc9;                                             // 9 satélites
    d.writeUInt32BE(lat, 7); d.writeUInt32BE(lon, 11);
    d[15] = 42;                                              // km/h
    d.writeUInt16BE(0x1000 | 0x0800 | 135, 16);              // con fix, OESTE, sur (sin la bandera norte), rumbo 135
    const m = g.leer(trama(0x12, d, 7));
    assert.ok(m.ok); assert.strictEqual(m.tipo, "posicion");
    assert.ok(Math.abs(m.gps.lat - -34.9011) < 0.0001, `lat ${m.gps.lat}`);
    assert.ok(Math.abs(m.gps.lon - -56.1645) < 0.0001, `lon ${m.gps.lon}`);
    assert.strictEqual(m.gps.velocidad, 42); assert.strictEqual(m.gps.rumbo, 135);
    assert.strictEqual(m.gps.satelites, 9); assert.strictEqual(m.gps.conFix, true);
    assert.strictEqual(m.gps.fecha.toISOString(), "2026-11-20T13:30:15.000Z");
    assert.ok(!g.pideAcuse(m));
});
prueba("el latido dice encendido, batería y señal", () => {
    const m = g.leer(trama(0x13, Buffer.from([0x46, 0x04, 0x03, 0x00, 0x02]), 9));
    assert.strictEqual(m.tipo, "estado");
    assert.strictEqual(m.estado.encendido, true); assert.strictEqual(m.estado.cargando, true);
    assert.strictEqual(m.estado.bateria, 4); assert.strictEqual(m.estado.senal, 3);
    assert.ok(g.pideAcuse(m));
});
prueba("lo desconocido no rompe: se devuelve en crudo", () => {
    const m = g.leer(trama(0x77, Buffer.from([1, 2, 3]), 3));
    assert.ok(m.ok); assert.strictEqual(m.tipo, "desconocido");
});

console.log(`\n${ok} bien, ${mal} mal`);
process.exit(mal ? 1 : 0);
