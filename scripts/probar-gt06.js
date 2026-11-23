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
prueba("una geocerca con horario avisa sólo cuando vigila, pero no pierde de qué lado quedó el vehículo", () => {
    const v = ev.nuevoVigia(), UY = "America/Montevideo";
    // «Que avise si sale del depósito de noche»: vigila de 22 a 6, sólo la salida.
    const deposito = { id: "g5", nombre: "Depósito", lat: -34.8894, lon: -56.1440, radio: 200, avisa: "sale", horario: { dias: [0, 1, 2, 3, 4, 5, 6], desde: "22:00", hasta: "06:00" } };
    const a = (iso, lat) => ({ conFix: true, lat, lon: -56.1440, fecha: new Date(`${iso}-03:00`) });
    const DENTRO = -34.8894, FUERA = -34.8950;
    assert.deepStrictEqual(v.alUbicarse("a", [deposito], a("2026-11-23T09:00:00", DENTRO), UY), []);   // primera vez
    // Sale a las diez de la mañana: no es su horario, no avisa…
    v.alUbicarse("a", [deposito], a("2026-11-23T10:00:00", FUERA), UY);
    assert.deepStrictEqual(v.alUbicarse("a", [deposito], a("2026-11-23T10:00:10", FUERA), UY), []);
    // …pero quedó anotado afuera: el primer reporte de la noche, todavía afuera, NO es una salida.
    assert.deepStrictEqual(v.alUbicarse("a", [deposito], a("2026-11-23T22:30:00", FUERA), UY), []);
    assert.deepStrictEqual(v.lados("a"), { g5: false });
    // Vuelve de noche: entra, y esta geocerca sólo avisa la salida.
    v.alUbicarse("a", [deposito], a("2026-11-23T23:00:00", DENTRO), UY);
    assert.deepStrictEqual(v.alUbicarse("a", [deposito], a("2026-11-23T23:00:10", DENTRO), UY), []);
    // Y a las tres de la mañana sale: ésa es la que avisa.
    v.alUbicarse("a", [deposito], a("2026-11-24T03:00:00", FUERA), UY);
    const sale = v.alUbicarse("a", [deposito], a("2026-11-24T03:00:10", FUERA), UY);
    assert.strictEqual(sale.length, 1); assert.strictEqual(sale[0].tipo, "GPS_GEOCERCA_SALE");
});
prueba("una geocerca de forma libre se cruza por su forma, y el lugar se dice desde su borde", () => {
    const v = ev.nuevoVigia();
    // Un predio en L: el hueco de la L está adentro del círculo que lo contiene y afuera del predio.
    const predio = { id: "g6", nombre: "Predio", lat: -34.901, lon: -56.099, radio: 150,
        puntos: [[-34.900, -56.100], [-34.900, -56.098], [-34.901, -56.098], [-34.901, -56.099], [-34.902, -56.099], [-34.902, -56.100]] };
    const brazo = { conFix: true, lat: -34.9005, lon: -56.0990 }, hueco = { conFix: true, lat: -34.9015, lon: -56.0985 };
    assert.deepStrictEqual(v.alUbicarse("a", [predio], brazo), []);
    v.alUbicarse("a", [predio], hueco);
    assert.strictEqual(v.alUbicarse("a", [predio], hueco)[0].tipo, "GPS_GEOCERCA_SALE");
    assert.strictEqual(ev.lugarDe(-34.9005, -56.0990, [predio]), "en Predio");
    assert.match(ev.lugarDe(-34.899, -56.099, [predio]), /^a 1[01]0 m de Predio$/);
});
prueba("el cruce con la cámara: avisa cuando el rastreador está en otro lado, y sin dato no opina", () => {
    const camara = { lat: -34.8560, lon: -56.0740 }, T = Date.parse("2026-11-23T15:00:00Z");
    const en = (lat, seg) => ({ lat, lon: -56.0740, cuando: T - seg * 1000 });
    // Pasando por la cámara: la posición de hace 8 s, a 60 m.
    assert.strictEqual(ev.cruzarLectura({ camara, cuando: T, posicion: en(-34.8565, 8), vivo: true }).que, "coincide");
    // Andando: hace 40 s estaba a 1,5 km. A velocidad de ruta pudo llegar: no se avisa.
    assert.strictEqual(ev.cruzarLectura({ camara, cuando: T, posicion: en(-34.8695, 40), vivo: true }).que, "coincide");
    // Andando, pero hace 10 s estaba a 14 km: no es él.
    const lejos = ev.cruzarLectura({ camara, cuando: T, posicion: en(-34.982, 10), vivo: true });
    assert.strictEqual(lejos.que, "lejos"); assert.ok(lejos.metros > 13000 && lejos.metros < 15000, String(lejos.metros));
    // Estacionado en casa desde hace tres horas, latiendo: sigue ahí. Una chapa igual entra al barrio.
    assert.strictEqual(ev.cruzarLectura({ camara, cuando: T, posicion: en(-34.982, 3 * 3600), vivo: true }).que, "lejos");
    // La misma posición vieja, pero el equipo dejó de reportar: no se sabe dónde está. No se opina.
    assert.strictEqual(ev.cruzarLectura({ camara, cuando: T, posicion: en(-34.982, 3 * 3600), vivo: false }).que, "sin-dato");
    // Estacionado adentro del barrio, a 300 m de la cámara: es él.
    assert.strictEqual(ev.cruzarLectura({ camara, cuando: T, posicion: en(-34.8587, 3 * 3600), vivo: true }).que, "coincide");
    // Sin ninguna posición, o con una posterior a la lectura: sin dato.
    assert.strictEqual(ev.cruzarLectura({ camara, cuando: T, posicion: null, vivo: true }).que, "sin-dato");
    assert.strictEqual(ev.cruzarLectura({ camara, cuando: T, posicion: en(-34.982, -30), vivo: true }).que, "sin-dato");
    assert.strictEqual(ev.distanciaLegible(14180), "14 km"); assert.strictEqual(ev.distanciaLegible(1840), "1,8 km"); assert.strictEqual(ev.distanciaLegible(830), "850 m");
    assert.strictEqual(ev.PRIORIDAD.GPS_LPR_LEJOS, 2);
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

console.log("lib-teltonika");
const tk = require(path.join(__dirname, "..", "lib-teltonika.js"));
/* Las dos tramas de ejemplo de la documentación pública del fabricante (Codec 8 y Codec 8
   Extended). Que el CRC cierre es la prueba de que están bien copiadas. */
const TK8 = "000000000000003608010000016B40D8EA30010000000000000000000000000000000105021503010101425E0F01F10000601A014E0000000000000000010000C7CF";
const TK8E = "000000000000004A8E010000016B412CEE000100000000000000000000000000000000010005000100010100010011001D00010010015E2C880002000B000000003544C87A000E000000001DD7E06A00000100002994";
/** Arma un paquete Codec 8 con un registro: para probar lo que los ejemplos no traen (una posición de verdad). */
function paqueteTk({ cuando, lat, lon, vel = 0, rumbo = 0, sats = 10, prioridad = 0, evento = 0, es1 = {}, es2 = {} }) {
    const r = Buffer.alloc(24);
    r.writeBigUInt64BE(BigInt(cuando.getTime()), 0); r[8] = prioridad;
    r.writeInt32BE(Math.round(lon * 1e7), 9); r.writeInt32BE(Math.round(lat * 1e7), 13);
    r.writeInt16BE(40, 17); r.writeUInt16BE(rumbo, 19); r[21] = sats; r.writeUInt16BE(vel, 22);
    const u = Object.entries(es1), d = Object.entries(es2);
    const io = Buffer.concat([
        Buffer.from([evento, u.length + d.length, u.length]), ...u.map(([id, v]) => Buffer.from([Number(id), v])),
        Buffer.from([d.length]), ...d.map(([id, v]) => { const b = Buffer.alloc(3); b[0] = Number(id); b.writeUInt16BE(v, 1); return b; }),
        Buffer.from([0, 0]),
    ]);
    const datos = Buffer.concat([Buffer.from([0x08, 1]), r, io, Buffer.from([1])]);
    const cab = Buffer.alloc(8); cab.writeUInt32BE(datos.length, 4);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(tk.crc16(datos));
    return Buffer.concat([cab, datos, crc]);
}
prueba("Teltonika: el CRC cierra en los dos ejemplos del fabricante", () => {
    for (const [h, crc] of [[TK8, 0xc7cf], [TK8E, 0x2994]]) { const b = H(h); assert.strictEqual(tk.crc16(b.subarray(8, 8 + b.readUInt32BE(4))), crc); }
});
prueba("Teltonika: el ejemplo de Codec 8 dice lo que dice su documentación", () => {
    const m = tk.leer(H(TK8));
    assert.ok(m.ok); assert.strictEqual(m.registros.length, 1);
    const r = m.registros[0];
    assert.strictEqual(r.gps.fecha.toISOString(), "2019-06-10T10:04:46.000Z");
    assert.strictEqual(r.prioridad, 1); assert.strictEqual(r.evento, 1);
    assert.deepStrictEqual(r.es, { 1: 1, 21: 3, 66: 24079, 78: 0, 241: 24602 });   // entrada 1, señal 3, 24,079 V, operador
    assert.strictEqual(r.voltaje, 24.079); assert.strictEqual(r.senal, 3);
    assert.strictEqual(r.gps.conFix, false);                                          // el ejemplo viene sin satélites
});
prueba("Teltonika: el ejemplo de Codec 8 Extended (ids de dos bytes)", () => {
    const m = tk.leer(H(TK8E));
    assert.ok(m.ok); assert.strictEqual(m.codec, 0x8e);
    assert.deepStrictEqual(m.registros[0].es, { 1: 1, 11: 893700218, 14: 500686954, 16: 22949000, 17: 29 });
    assert.strictEqual(m.registros[0].gps.fecha.toISOString(), "2019-06-10T11:36:32.000Z");
});
prueba("Teltonika: una posición en Montevideo queda en el hemisferio correcto (enteros con signo)", () => {
    const m = tk.leer(paqueteTk({ cuando: new Date("2026-11-21T12:00:00Z"), lat: -34.9011, lon: -56.1645, vel: 42, rumbo: 270, es1: { 239: 1 }, es2: { 66: 12650 } }));
    assert.ok(m.ok);
    const r = m.registros[0];
    assert.strictEqual(r.gps.lat, -34.9011); assert.strictEqual(r.gps.lon, -56.1645);
    assert.strictEqual(r.gps.velocidad, 42); assert.strictEqual(r.gps.rumbo, 270); assert.strictEqual(r.gps.satelites, 10); assert.ok(r.gps.conFix);
    assert.strictEqual(r.encendido, true); assert.strictEqual(r.voltaje, 12.65);
    assert.strictEqual(tk.eventoDe(r), null);                                         // un registro periódico no es un evento
});
prueba("Teltonika: el inhibidor, el desenchufe y el pánico; y un estado que sigue no vuelve a avisar", () => {
    const base = { cuando: new Date("2026-11-21T12:00:00Z"), lat: -34.9, lon: -56.16 };
    const r = (x) => tk.leer(paqueteTk({ ...base, ...x })).registros[0];
    assert.strictEqual(tk.eventoDe(r({ evento: 249, es1: { 249: 1 } })), "GPS_INHIBIDOR");
    assert.strictEqual(tk.eventoDe(r({ evento: 249, es1: { 249: 0 } })), null);        // el inhibidor se fue: no es otra alarma
    assert.strictEqual(tk.eventoDe(r({ evento: 252, es1: { 252: 1 } })), "GPS_CORTE");
    assert.strictEqual(tk.eventoDe(r({ evento: 0, es1: { 252: 1 } })), null);          // periódico, con el estado adentro
    assert.strictEqual(tk.eventoDe(r({ prioridad: 2 })), "GPS_SOS");
    assert.strictEqual(tk.eventoDe(r({ evento: 246, es1: { 246: 1 } })), "GPS_MOVIMIENTO");
});
prueba("Teltonika: el saludo se reconoce, un GT06 no se confunde, y dos paquetes pegados se separan", () => {
    const saludo = Buffer.concat([Buffer.from([0x00, 0x0f]), Buffer.from("356307042441013")]);
    assert.strictEqual(tk.esSaludo(saludo), true); assert.strictEqual(tk.imeiDeSaludo(saludo), "356307042441013");
    assert.strictEqual(tk.esSaludo(saludo.subarray(0, 9)), null);                      // todavía no llegó entero
    assert.strictEqual(tk.esSaludo(H(REALES[0])), false);                              // un login de GT06
    assert.strictEqual(tk.esSaludo(Buffer.from("GET / HTTP/1.1")), false);
    const dos = Buffer.concat([H(TK8), H(TK8E), H(TK8).subarray(0, 20)]);
    const p = tk.partir(dos);
    assert.strictEqual(p.paquetes.length, 2); assert.strictEqual(p.resto.length, 20); assert.strictEqual(p.roto, false);
    assert.strictEqual(tk.partir(Buffer.from("esto no es un paquete, es basura")).roto, true);
    // Un CRC roto no se da por bueno, y el acuse es la cuenta de registros en cuatro bytes.
    const roto = H(TK8); roto[30] ^= 0xff; assert.strictEqual(tk.leer(roto).ok, false);
    assert.strictEqual(tk.acusePaquete(1).toString("hex"), "00000001");
});


console.log("lib-topfly");
const tf = require(path.join(__dirname, "..", "lib-topfly.js"));
/* Lo que mandó de verdad el TorchX 110 de Nico el 23/11, una y otra vez, mientras el receptor lo
   cortaba por «no habla el protocolo» (capturado en el puerto, antes de escribir el driver). */
const TF_LOGIN = "2626010023000508672840638263430102000026052510111103020503010503020412";
prueba("TopFly: la presentación real del TorchX trae su IMEI, la serie y el modelo", () => {
    const m = tf.leer(H(TF_LOGIN));
    assert.strictEqual(m.ok, true); assert.strictEqual(m.tipo, "login");
    assert.strictEqual(m.imei, "867284063826343"); assert.strictEqual(m.serie, 5);
    assert.strictEqual(m.modelo, 0x0102);
});
prueba("TopFly: el acuse de la presentación es el mismo sobre, sin contenido y con largo 15", () => {
    const a = tf.acuse(tf.leer(H(TF_LOGIN)));
    assert.strictEqual(a.toString("hex"), "262601000f00050867284063826343");
    assert.strictEqual(a.readUInt16BE(3), a.length);
});
prueba("TopFly: se reconoce por los dos primeros bytes, y no se confunde con GT06 ni con Teltonika", () => {
    assert.strictEqual(tf.esInicio(H(TF_LOGIN)), true);
    assert.strictEqual(tf.esInicio(H("26")), null);                                    // todavía no alcanza
    assert.strictEqual(tf.esInicio(H(REALES[0])), false);                              // un login de GT06
    assert.strictEqual(tf.esInicio(Buffer.from([0x00, 0x0f])), false);                 // el saludo de un Teltonika
    assert.strictEqual(tk.esSaludo(H(TF_LOGIN)), false);
    assert.strictEqual(tf.esInicio(H("2525010023")), false);                           // otra familia de la marca: no se lee
});
prueba("TopFly: dos tramas pegadas se separan, una por la mitad se espera, y la basura se corta", () => {
    const dos = Buffer.concat([H(TF_LOGIN), H(TF_LOGIN)]);
    assert.strictEqual(tf.partir(dos).tramas.length, 2);
    const p = tf.partir(dos.subarray(0, 50));
    assert.strictEqual(p.tramas.length, 1); assert.strictEqual(p.resto.length, 15); assert.strictEqual(p.roto, false);
    assert.strictEqual(tf.partir(H("262601")).roto, false);                            // ni el largo llegó: se espera
    assert.strictEqual(tf.partir(Buffer.from("GET / HTTP/1.1\r\n")).roto, true);
    assert.strictEqual(tf.partir(H("2626010003000508")).roto, true);                   // un largo menor que el sobre
    assert.strictEqual(tf.partir(H("262601ffff000508")).roto, true);                   // un largo que no es de un rastreador
    assert.strictEqual(tf.partir(Buffer.concat([H(TF_LOGIN), Buffer.from("xx")])).roto, true);
});
prueba("TopFly: un IMEI que no son quince dígitos no se da por bueno", () => {
    const t = H(TF_LOGIN); t[8] = 0xff;
    assert.strictEqual(tf.leer(t).ok, false);
});

console.log(`\n${ok} bien, ${mal} mal`);
process.exit(mal ? 1 : 0);
