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
prueba("la posición REAL del equipo (20/11) cae en Montevideo, con 12 satélites", () => {
    const m = g.leer(H("787823121a0b14020115cc03be443106060af4005800000000000000000000000000000b42f30d0a"));
    assert.ok(m.ok); assert.strictEqual(m.tipo, "posicion");
    assert.strictEqual(m.gps.fecha.toISOString(), "2026-11-20T02:01:21.000Z");
    assert.strictEqual(m.gps.satelites, 12); assert.strictEqual(m.gps.conFix, true);
    assert.ok(m.gps.lat < -34.8 && m.gps.lat > -35.0, `lat ${m.gps.lat}`);
    assert.ok(m.gps.lon < -56.0 && m.gps.lon > -56.3, `lon ${m.gps.lon}`);
});
prueba("la trama REAL sin satélites dice que no tiene fix (y no se debe guardar)", () => {
    const m = g.leer(H("787823121a0b140d3929c003be4303060609ee00480002ec0ae7724e7a0500000000001228850d0a"));
    assert.ok(m.ok); assert.strictEqual(m.gps.satelites, 0); assert.strictEqual(m.gps.conFix, false);
    // La hora del equipo es UTC: esta trama llegó a las 13:57:46Z y dice 13:57:41Z.
    assert.strictEqual(m.gps.fecha.toISOString(), "2026-11-20T13:57:41.000Z");
});
prueba("el latido REAL: cargando, motor apagado, batería llena, señal fuerte", () => {
    const m = g.leer(H("78780a130406040002000e82250d0a"));
    assert.strictEqual(m.tipo, "estado"); assert.strictEqual(m.estado.cargando, true);
    assert.strictEqual(m.estado.encendido, false); assert.strictEqual(m.estado.bateria, 6); assert.strictEqual(m.estado.senal, 4);
});
prueba("el voltaje REAL del vehículo: 11,70 V, lo mismo que contesta por SMS", () => {
    const m = g.leer(H("79790008940004920010548d0d0a"));
    assert.ok(m.ok); assert.strictEqual(m.tipo, "info"); assert.strictEqual(m.voltaje, 11.7);
});
prueba("los datos REALES de la SIM traen el ICCID", () => {
    const m = g.leer(H("79790020940a086519007574988074810001200358008959810625020035864f000fdb490d0a"));
    assert.ok(m.ok); assert.strictEqual(m.tipo, "info"); assert.strictEqual(m.iccid, "8959810625020035864");
});
prueba("lo desconocido no rompe: se devuelve en crudo", () => {
    const m = g.leer(trama(0x77, Buffer.from([1, 2, 3]), 3));
    assert.ok(m.ok); assert.strictEqual(m.tipo, "desconocido");
});

console.log("lib-gps-eventos");
const ev = require(path.join(__dirname, "..", "lib-gps-eventos.js"));
prueba("la batería baja avisa al CAER, no mientras sigue baja", () => {
    const v = ev.nuevoVigia();
    assert.strictEqual(v.alVoltaje("a", 12.6), null);          // primera lectura: no se sabe de dónde venía
    assert.strictEqual(v.alVoltaje("a", 11.7), "GPS_BATERIA"); // cayó
    assert.strictEqual(v.alVoltaje("a", 11.6), null);          // sigue baja: no repite
    assert.strictEqual(v.alVoltaje("a", 11.9), null);          // subió un poco, pero no se recuperó
    assert.strictEqual(v.alVoltaje("a", 11.7), null);          // así que tampoco vuelve a avisar
    assert.strictEqual(v.alVoltaje("a", 12.4), null);          // se recuperó
    assert.strictEqual(v.alVoltaje("a", 11.5), "GPS_BATERIA"); // y volvió a caer: aviso nuevo
});
prueba("reiniciar el receptor con la batería ya baja no dispara un aviso (el caso real: 11,7 V)", () => {
    const v = ev.nuevoVigia(); v.sembrar("a", 11.7);
    assert.strictEqual(v.alVoltaje("a", 11.7), null);
});
prueba("moverse con el motor apagado avisa una vez por traslado", () => {
    const v = ev.nuevoVigia(); const t = 1e12;
    assert.strictEqual(v.alMoverse("a", { conFix: true, velocidad: 30, encendido: false }, t), "GPS_MOVIMIENTO");
    assert.strictEqual(v.alMoverse("a", { conFix: true, velocidad: 35, encendido: false }, t + 10000), null);
    // Se detiene; a los 5 minutos quieto, el traslado terminó.
    assert.strictEqual(v.alMoverse("a", { conFix: true, velocidad: 0, encendido: false }, t + 20000), null);
    assert.strictEqual(v.alMoverse("a", { conFix: true, velocidad: 0, encendido: false }, t + 20000 + 5 * 60000), null);
    assert.strictEqual(v.alMoverse("a", { conFix: true, velocidad: 25, encendido: false }, t + 20000 + 6 * 60000), "GPS_MOVIMIENTO");
});
prueba("andando con el motor ENCENDIDO no es una alarma, y sin saber del motor tampoco", () => {
    const v = ev.nuevoVigia();
    assert.strictEqual(v.alMoverse("a", { conFix: true, velocidad: 60, encendido: true }), null);
    assert.strictEqual(v.alMoverse("b", { conFix: true, velocidad: 60, encendido: null }), null);
    assert.strictEqual(v.alMoverse("c", { conFix: false, velocidad: 60, encendido: false }), null);   // sin satélites la velocidad no vale
});
prueba("los códigos de alarma del equipo se traducen, y el desconocido no se pierde", () => {
    assert.strictEqual(ev.eventoDeAlarma(0x01), "GPS_SOS");
    assert.strictEqual(ev.eventoDeAlarma(0x02), "GPS_CORTE");
    assert.strictEqual(ev.eventoDeAlarma(0x55), "GPS_OTRA");
    assert.strictEqual(ev.eventoDeAlarma(0), null);
});
prueba("la geocerca avisa al cruzar, no al verla por primera vez ni por el ruido del borde", () => {
    const v = ev.nuevoVigia();
    const base = { id: "g1", nombre: "Base", lat: -34.8894, lon: -56.1440, radio: 200 };
    const adentro = { conFix: true, lat: -34.8894, lon: -56.1440 };
    const afuera = { conFix: true, lat: -34.8950, lon: -56.1440 };       // ~620 m al sur
    assert.deepStrictEqual(v.alUbicarse("a", [base], adentro), []);       // primera vez: se anota, no avisa
    assert.deepStrictEqual(v.alUbicarse("a", [base], afuera), []);        // un solo punto afuera: todavía no
    assert.deepStrictEqual(v.alUbicarse("a", [base], adentro), []);       // volvió: era ruido
    assert.deepStrictEqual(v.alUbicarse("a", [base], afuera), []);
    const sale = v.alUbicarse("a", [base], afuera);                       // dos seguidos: salió
    assert.strictEqual(sale.length, 1); assert.strictEqual(sale[0].tipo, "GPS_GEOCERCA_SALE"); assert.strictEqual(sale[0].geocerca.nombre, "Base");
    assert.deepStrictEqual(v.alUbicarse("a", [base], afuera), []);        // sigue afuera: no repite
    v.alUbicarse("a", [base], adentro);
    assert.strictEqual(v.alUbicarse("a", [base], adentro)[0].tipo, "GPS_GEOCERCA_ENTRA");
});
prueba("una geocerca apagada, o de otro rastreador, no dice nada", () => {
    const v = ev.nuevoVigia();
    const p1 = { conFix: true, lat: -34.8894, lon: -56.1440 }, p2 = { conFix: true, lat: -34.95, lon: -56.1440 };
    const apagada = { id: "g2", lat: -34.8894, lon: -56.1440, radio: 100, activa: false };
    const ajena = { id: "g3", lat: -34.8894, lon: -56.1440, radio: 100, imeis: ["otro"] };
    for (const p of [p1, p2, p2, p2]) assert.deepStrictEqual(v.alUbicarse("a", [apagada, ajena], p), []);
    // Y sin satélites una posición no cruza nada.
    assert.deepStrictEqual(v.alUbicarse("a", [{ id: "g4", lat: 0, lon: 0, radio: 10 }], { conFix: false, lat: 0, lon: 0 }), []);
});
prueba("las alarmas REALES del equipo (21/11): corte, vibración y las dos de «zona sin GPS»", () => {
    const reales = {
        0x02: "787825161a0b150b072dcb03be42ae06060a2700d95f0902ec0ae7724e7a08d20604020202b518380d0a",
        0x03: "787825161a0b140e1212c003be4303060609ee00c8000902ec0ae7724e7a050e06040302001fd25c0d0a",
        0x0a: "787825161a0b15001732c003be313b0606330500c9320902ec0ae7724e7a038606040a02042ad76e0d0a",
        0x0b: "787825161a0b15001733c003be313b0606330500c9320902ec0ae7724e7a038606040b02042b236d0d0a",
    };
    for (const [codigo, hex] of Object.entries(reales)) {
        const m = g.leer(H(hex));
        assert.ok(m.ok, "CRC"); assert.strictEqual(m.tipo, "alarma"); assert.strictEqual(m.alarma, Number(codigo));
        assert.ok(g.pideAcuse(m));
    }
    assert.strictEqual(ev.eventoDeAlarma(0x02), "GPS_CORTE");
    assert.strictEqual(ev.eventoDeAlarma(0x03), "GPS_VIBRACION");
    // Entrar a un garage no es una alarma: se anota y no se avisa.
    assert.ok(ev.SOLO_SE_ANOTA.has(ev.eventoDeAlarma(0x0a)) && ev.SOLO_SE_ANOTA.has(ev.eventoDeAlarma(0x0b)));
    assert.ok(!ev.SOLO_SE_ANOTA.has("GPS_CORTE"));
    // La alarma de corte llegó con 11 satélites y fix; la de vibración, sin satélites.
    assert.strictEqual(g.leer(H(reales[0x02])).gps.conFix, true);
    assert.strictEqual(g.leer(H(reales[0x03])).gps.conFix, false);
});
prueba("el latido REAL trae su código de alarma en cero", () => {
    assert.strictEqual(g.leer(H("78780a130406040002000e82250d0a")).estado.alarma, 0);
});

prueba("el silencio: estacionado avisa a los 15 minutos, andando a los 5, y una sola vez", () => {
    const t0 = Date.parse("2026-11-21T12:00:00Z"), min = 60_000;
    const quieto = { ultimoLatido: new Date(t0), cuando: new Date(t0 - 40 * min), velocidad: 0, sinReporteDesde: null };
    assert.strictEqual(ev.seCallo(quieto, 0, t0 + 14 * min), false);
    assert.strictEqual(ev.seCallo(quieto, 0, t0 + 15 * min), true);
    const andando = { ultimoLatido: new Date(t0), cuando: new Date(t0 - 5_000), velocidad: 42, sinReporteDesde: null };
    assert.strictEqual(ev.veniaAndando(andando), true);
    assert.strictEqual(ev.seCallo(andando, 0, t0 + 4 * min), false);
    assert.strictEqual(ev.seCallo(andando, 0, t0 + 5 * min), true);
    // Ya avisado: no se repite.
    assert.strictEqual(ev.seCallo({ ...andando, sinReporteDesde: new Date(t0) }, 0, t0 + 60 * min), false);
    // Nunca habló: no hay silencio que medir.
    assert.strictEqual(ev.seCallo({ ultimoLatido: null }, 0, t0), false);
});
prueba("bajo techo con una posición vieja a 40 km/h NO venía andando", () => {
    const t0 = Date.parse("2026-11-21T12:00:00Z");
    // Sigue mandando latidos, pero la última posición es de hace una hora: eso es estar guardado.
    const e = { ultimoLatido: new Date(t0), cuando: new Date(t0 - 3600_000), velocidad: 40, sinReporteDesde: null };
    assert.strictEqual(ev.veniaAndando(e), false);
    assert.strictEqual(ev.seCallo(e, 0, t0 + 6 * 60_000), false);          // se juzga con los 15 minutos, no con los 5
});
prueba("si el receptor estuvo caído, el silencio se cuenta desde que arrancó", () => {
    const t0 = Date.parse("2026-11-21T12:00:00Z"), min = 60_000;
    const e = { ultimoLatido: new Date(t0), cuando: new Date(t0 - 60 * min), velocidad: 0, sinReporteDesde: null };
    const arranque = t0 + 40 * min;                                          // el receptor volvió 40 minutos después
    assert.strictEqual(ev.seCallo(e, arranque, arranque + 1 * min), false);  // los que no escuchamos fuimos nosotros
    assert.strictEqual(ev.seCallo(e, arranque, arranque + 15 * min), true);
});
prueba("«dejó de reportar» andando es prioridad 2; estacionado, 3; la vibración no abre un caso", () => {
    assert.strictEqual(ev.prioridadDe("GPS_SIN_REPORTE", { andando: true }), 2);
    assert.strictEqual(ev.prioridadDe("GPS_SIN_REPORTE", { andando: false }), 3);
    assert.strictEqual(ev.prioridadDe("GPS_SOS"), 1);
    assert.strictEqual(ev.prioridadDe("GPS_VIBRACION"), null);
    assert.strictEqual(ev.prioridadDe("GPS_GEOCERCA_SALE"), null);
    assert.strictEqual(ev.prioridadDe("GPS_VOLVIO"), null);
});
prueba("una posición atrasada: a tiempo es 0, nueve minutos tarde son 540 s", () => {
    const llego = Date.parse("2026-11-21T12:10:00Z");
    assert.strictEqual(ev.atrasoDe(new Date(llego - 3_000), llego), 0);      // la demora normal: 2 a 4 segundos
    assert.strictEqual(ev.atrasoDe(new Date(llego - 119_000), llego), 0);
    assert.strictEqual(ev.atrasoDe(new Date(llego - 540_000), llego), 540);
    assert.strictEqual(ev.atrasoDe(null, llego), 0);
    // Una hora del futuro o de hace dos meses no es una hora.
    assert.strictEqual(ev.horaCreible(new Date(llego + 3600_000), llego), false);
    assert.strictEqual(ev.horaCreible(new Date(llego - 60 * 86_400_000), llego), false);
    assert.strictEqual(ev.horaCreible(new Date(llego - 14 * 60_000), llego), true);
});
prueba("un salto imposible: 5 km en 10 segundos sí; 5 km en 10 minutos no; después de un hueco no se juzga", () => {
    const t = Date.parse("2026-11-21T12:00:00Z");
    const a = { lat: -34.9000, lon: -56.1600, cuando: t };
    const lejos = { lat: -34.9450, lon: -56.1600 };                          // ~5 km al sur
    assert.strictEqual(ev.esSaltoImposible(a, { ...lejos, cuando: t + 10_000 }), true);
    assert.strictEqual(ev.esSaltoImposible(a, { ...lejos, cuando: t + 9.5 * 60_000 }), false);   // 31 km/h
    assert.strictEqual(ev.esSaltoImposible(a, { ...lejos, cuando: t + 11 * 60_000 }), false);    // fuera de la ventana
    // Ruido de GPS (300 m en 10 s son 108 km/h «imposibles» para un auto quieto, pero no llega a 2 km): no es esto.
    assert.strictEqual(ev.esSaltoImposible(a, { lat: -34.9027, lon: -56.16, cuando: t + 10_000 }), false);
    assert.strictEqual(ev.esSaltoImposible(null, { ...lejos, cuando: t }), false);
});
prueba("el lugar en palabras: adentro, cerca, y lejos no dice nada", () => {
    const base = { nombre: "Base", lat: -34.9, lon: -56.16, radio: 100 };
    assert.strictEqual(ev.lugarDe(-34.9, -56.16, [base]), "en Base");
    assert.strictEqual(ev.lugarDe(-34.905, -56.16, [base]), "a 450 m de Base");
    assert.strictEqual(ev.lugarDe(-35.2, -56.16, [base]), null);
    assert.strictEqual(ev.lugarDe(-34.9, -56.16, []), null);
    // Entre dos, gana la del borde más cercano.
    const taller = { nombre: "Taller", lat: -34.906, lon: -56.16, radio: 50 };
    assert.strictEqual(ev.lugarDe(-34.905, -56.16, [base, taller]), "a 60 m de Taller");
});
prueba("los lados de las geocercas sobreviven a un reinicio: la salida que pasó en el medio se avisa", () => {
    const gc = [{ id: "g1", nombre: "Base", lat: -34.9, lon: -56.16, radio: 200 }];
    const adentro = { conFix: true, lat: -34.9, lon: -56.16 }, afuera = { conFix: true, lat: -34.91, lon: -56.16 };
    const v1 = ev.nuevoVigia();
    v1.alUbicarse("a", gc, adentro);
    const guardado = JSON.parse(JSON.stringify(v1.lados("a")));
    assert.deepStrictEqual(guardado, { g1: true });
    // Reinicio: un vigía nuevo, sembrado con lo guardado. El vehículo salió mientras tanto.
    const v2 = ev.nuevoVigia();
    v2.sembrarLados("a", guardado);
    assert.deepStrictEqual(v2.alUbicarse("a", gc, afuera), []);            // primera: falta confirmar
    const cruces = v2.alUbicarse("a", gc, afuera);
    assert.strictEqual(cruces.length, 1); assert.strictEqual(cruces[0].tipo, "GPS_GEOCERCA_SALE");
    assert.deepStrictEqual(v2.lados("a"), { g1: false });
    // Sin sembrar (como era antes), ese mismo cruce se perdía.
    const v3 = ev.nuevoVigia();
    v3.alUbicarse("a", gc, afuera); assert.deepStrictEqual(v3.alUbicarse("a", gc, afuera), []);
});

console.log(`\n${ok} bien, ${mal} mal`);
process.exit(mal ? 1 : 0);
