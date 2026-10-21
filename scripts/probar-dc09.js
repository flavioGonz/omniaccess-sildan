#!/usr/bin/env node
/**
 * Pruebas del protocolo SIA DC-09 (lib-dc09.js y lib-dc09-codigos.js), sin base ni red.
 *   node scripts/probar-dc09.js
 * Sale con código 1 si alguna falla.
 */
"use strict";
const assert = require("assert");
const path = require("path");
const dc = require(path.join(__dirname, "..", "lib-dc09.js"));
const cod = require(path.join(__dirname, "..", "lib-dc09-codigos.js"));

let ok = 0, mal = 0;
function prueba(nombre, fn) {
    try { fn(); ok++; console.log("  ✓", nombre); }
    catch (e) { mal++; console.log("  ✗", nombre, "\n     ", e.message); }
}

console.log("lib-dc09");
prueba("CRC-16 ARC del vector de la norma («123456789» = 0xBB3D)", () => assert.strictEqual(dc.crc16("123456789"), 0xbb3d));
prueba("CRC y largo de un ejemplo de la norma", () => {
    // Ejemplo de DC-09 (anexo): "SIA-DCS"0002R1L232#78919[1234|NFA129][S123Main St., 55123]_11:10:00,10-12-2019
    const cuerpo = '"SIA-DCS"0002R1L232#78919[1234|NFA129][S123Main St., 55123]_11:10:00,10-12-2019';
    const t = `\n${dc.crc16(cuerpo).toString(16).toUpperCase().padStart(4, "0")}0${cuerpo.length.toString(16).toUpperCase().padStart(3, "0")}${cuerpo}\r`;
    const m = dc.leer(t);
    assert.ok(m.ok, m.error);
    assert.strictEqual(m.id, "SIA-DCS"); assert.strictEqual(m.seq, 2); assert.strictEqual(m.receptor, "1"); assert.strictEqual(m.linea, "232"); assert.strictEqual(m.cuenta, "78919");
    assert.deepStrictEqual(m.extendidos, ["S123Main St., 55123"]);
    assert.strictEqual(m.cuentaDatos, "1234"); assert.strictEqual(m.datos, "NFA129");
    assert.strictEqual(cod.traducir(m)[0].tipo, "INCENDIO"); assert.strictEqual(cod.traducir(m)[0].zona, 129);
    assert.strictEqual(m.hora.toISOString(), "2019-10-12T11:10:00.000Z");
});
prueba("Armar y leer sin cifrar", () => {
    const t = dc.armar({ id: "SIA-DCS", seq: 12, receptor: "1", linea: "1", cuenta: "1234", datos: "Nri1/BA003" });
    const m = dc.leer(t);
    assert.ok(m.ok, m.error); assert.strictEqual(m.seq, 12); assert.strictEqual(m.datos, "Nri1/BA003"); assert.strictEqual(m.cuentaDatos, "1234"); assert.ok(!m.cifrado);
});
prueba("CRC roto → NAK", () => {
    const t = dc.armar({ id: "SIA-DCS", seq: 1, cuenta: "1234", datos: "Nri1/BA003" });
    const roto = t.slice(0, 1) + (t[1] === "0" ? "1" : "0") + t.slice(2);
    const m = dc.leer(roto);
    assert.ok(!m.ok); assert.strictEqual(m.error, "crc"); assert.strictEqual(m.respuesta, "NAK");
});
prueba("Largo equivocado → NAK", () => {
    const t = dc.armar({ id: "NULL", seq: 1, cuenta: "1234" });
    const m = dc.leer(t.replace(/^(\n.{4}0)(.{3})/, (_, a, b) => a + (parseInt(b, 16) + 1).toString(16).toUpperCase().padStart(3, "0")));
    assert.strictEqual(m.error, "largo");
});
prueba("ID desconocido → DUH", () => {
    const cuerpo = '"FOO-BAR"0001L0#1234[]';
    const t = `\n${dc.crc16(cuerpo).toString(16).toUpperCase().padStart(4, "0")}0${cuerpo.length.toString(16).toUpperCase().padStart(3, "0")}${cuerpo}\r`;
    const m = dc.leer(t);
    assert.strictEqual(m.respuesta, "DUH");
});
for (const [nombre, clave] of [["AES-128 texto", "ClaveDePrueba123"], ["AES-128 hex", "00112233445566778899AABBCCDDEEFF"], ["AES-192 hex", "00112233445566778899AABBCCDDEEFF0011223344556677"], ["AES-256 texto", "Una clave de treinta y dos bytes"]]) {
    prueba(`Cifrado ida y vuelta (${nombre})`, () => {
        const modo = /^[0-9A-F]+$/.test(clave) ? "hex" : "texto";
        const t = dc.armar({ id: "SIA-DCS", seq: 7, receptor: "2", linea: "1", cuenta: "ABC1", datos: "Nri1/BA003", clave, modoClave: modo });
        assert.ok(t.includes('"*SIA-DCS"'));
        assert.ok(!t.includes("BA003"), "los datos no deben ir en claro");
        const m = dc.leer(t, (c) => (c === "ABC1" ? clave : null));
        assert.ok(m.ok, m.error); assert.ok(m.cifrado); assert.strictEqual(m.datos, "Nri1/BA003"); assert.ok(m.hora);
        // ACK cifrado: lo lee la central con la misma clave.
        const a = dc.leer(dc.ack(m, { clave }), () => clave);
        assert.ok(a.ok, a.error); assert.strictEqual(a.id, "ACK"); assert.strictEqual(a.seq, 7); assert.strictEqual(a.receptor, "2"); assert.strictEqual(a.cuenta, "ABC1"); assert.ok(a.cifrado);
    });
}
prueba("Clave hex de 32 dígitos tomada como texto por la central (AES-256): igual se descifra", () => {
    const clave = "00112233445566778899AABBCCDDEEFF";
    const t = dc.armar({ id: "ADM-CID", seq: 3, cuenta: "1234", datos: "1130 01 003", clave, modoClave: "texto" });
    const m = dc.leer(t, () => clave);
    assert.ok(m.ok, m.error); assert.strictEqual(m.modoClave, "texto");
});
prueba("Clave equivocada → NAK (descifrado)", () => {
    const t = dc.armar({ id: "SIA-DCS", seq: 1, cuenta: "1234", datos: "Nri1/BA003", clave: "ClaveDePrueba123" });
    const m = dc.leer(t, () => "OtraClaveDistint");
    assert.strictEqual(m.error, "descifrado"); assert.strictEqual(m.respuesta, "NAK");
});
prueba("Cifrado sin clave de esa cuenta → NAK", () => {
    const t = dc.armar({ id: "SIA-DCS", seq: 1, cuenta: "1234", datos: "Nri1/BA003", clave: "ClaveDePrueba123" });
    assert.strictEqual(dc.leer(t, () => null).error, "sin-clave");
});
prueba("Ventana de hora", () => {
    const vieja = new Date(Date.now() - 120_000);
    const m = dc.leer(dc.armar({ id: "NULL", seq: 1, cuenta: "1234", clave: "ClaveDePrueba123", hora: vieja }), () => "ClaveDePrueba123");
    assert.ok(m.ok, m.error); assert.ok(!dc.enVentana(m, 40)); assert.ok(dc.enVentana(m, 200));
});
prueba("NAK lleva la hora y la cuenta A0", () => {
    const m = dc.leer(dc.nak());
    // A0 no es una cuenta hex válida para leer(): se verifica la forma a mano.
    assert.ok(/"NAK"0000R0L0A0\[\]_\d{2}:\d{2}:\d{2},\d{2}-\d{2}-\d{4}\r$/.test(dc.nak()));
    assert.ok(m !== undefined);
});
prueba("Separar tramas de un búfer TCP (dos juntas y media)", () => {
    const a = dc.armar({ id: "NULL", seq: 1, cuenta: "1234" }), b = dc.armar({ id: "NULL", seq: 2, cuenta: "1234" });
    const r = dc.separar(a + b + b.slice(0, 10));
    assert.strictEqual(r.tramas.length, 2); assert.strictEqual(r.resto, b.slice(0, 10));
});

console.log("lib-dc09-codigos");
prueba("SIA robo zona 3 partición 1", () => {
    const [e] = cod.traducirSia("Nri1/BA003");
    assert.strictEqual(e.categoria, "ALARMA"); assert.strictEqual(e.tipo, "ROBO"); assert.strictEqual(e.zona, 3); assert.strictEqual(e.particion, 1);
});
prueba("SIA varios eventos y usuario en armado", () => {
    const ev = cod.traducirSia("Nri2/BA004/BR004/CL12");
    assert.strictEqual(ev.length, 3);
    assert.strictEqual(ev[1].categoria, "RESTAURACION"); assert.strictEqual(ev[1].restauraA, "BA");
    assert.strictEqual(ev[2].categoria, "ARMADO"); assert.strictEqual(ev[2].usuario, 12); assert.strictEqual(ev[2].zona, null); assert.strictEqual(ev[2].particion, 2);
});
prueba("Contact ID 1130 01 003 = robo nuevo", () => {
    const [e] = cod.traducirCid("1130 01 003");
    assert.strictEqual(e.categoria, "ALARMA"); assert.strictEqual(e.tipo, "ROBO"); assert.strictEqual(e.zona, 3); assert.strictEqual(e.particion, 1);
});
prueba("Contact ID 3130 = restauración", () => assert.strictEqual(cod.traducirCid("3130 01 003")[0].categoria, "RESTAURACION"));
prueba("Contact ID 3401 = armado por usuario 5, 1401 = desarmado", () => {
    const [a] = cod.traducirCid("3401 01 005"); const [d] = cod.traducirCid("1401 01 005");
    assert.strictEqual(a.categoria, "ARMADO"); assert.strictEqual(a.usuario, 5); assert.strictEqual(d.categoria, "DESARMADO");
});
prueba("Contact ID 1120 pánico, 1121 coacción, 1110 incendio, 1137 sabotaje", () => {
    assert.strictEqual(cod.traducirCid("1120 01 000")[0].tipo, "PANICO");
    assert.strictEqual(cod.traducirCid("1121 01 000")[0].tipo, "COACCION");
    assert.strictEqual(cod.traducirCid("1110 01 005")[0].tipo, "INCENDIO");
    assert.strictEqual(cod.traducirCid("1137 01 002")[0].tipo, "SABOTAJE");
});
prueba("Contact ID 1301 corte de corriente = falla, 3301 = fin de falla", () => {
    assert.strictEqual(cod.traducirCid("1301 00 000")[0].categoria, "FALLA");
    assert.strictEqual(cod.traducirCid("3301 00 000")[0].categoria, "FALLA_FIN");
});
prueba("Contact ID 1602 prueba periódica", () => assert.strictEqual(cod.traducirCid("1602 00 000")[0].categoria, "PRUEBA"));
prueba("NULL no tiene eventos", () => assert.deepStrictEqual(cod.traducir({ id: "NULL", datos: "" }), []));

console.log(`\n${ok} bien, ${mal} mal`);
process.exit(mal ? 1 : 0);
