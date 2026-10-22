/** Pruebas de lib-cms-salida (la salida a CMS de un receptor: IPC10 de Paradox, Sur-Gard). */
"use strict";
const assert = require("assert");
const cms = require("../lib-cms-salida");
const cod = require("../lib-dc09-codigos");
let ok = 0, mal = 0;
const prueba = (n, f) => { try { f(); ok++; console.log("  ✓", n); } catch (e) { mal++; console.log("  ✗", n, "\n   ", e.message); } };

prueba("Sur-Gard, ejemplo del manual", () => assert.deepStrictEqual(cms.leer("5011 181234E12101001"), { tipo: "evento", cuenta: "1234", datos: "1121 01 001" }));
prueba("Sur-Gard, desarmado de la cuenta 2989 (como el IPC10)", () => {
    const m = cms.leer("5011 182989E40101005");
    assert.deepStrictEqual(m, { tipo: "evento", cuenta: "2989", datos: "1401 01 005" });
    const [e] = cod.traducirCid(m.datos); assert.strictEqual(e.categoria, "DESARMADO"); assert.strictEqual(e.usuario, 5);
});
prueba("Sur-Gard, armado R401", () => assert.strictEqual(cod.traducirCid(cms.leer("5011 182989R40101007").datos)[0].categoria, "ARMADO"));
prueba("con línea de 3 dígitos (MLR2-DG, grupo 0-FFF)", () => assert.strictEqual(cms.leer("501005 182989E13001003").cuenta, "2989"));
prueba("cuenta hexa de 10 (el propio IPC10)", () => assert.deepStrictEqual(cms.leer("5011 180076C4250FE42200001"), { tipo: "evento", cuenta: "0076C4250F", datos: "1422 00 001" }));
prueba("Ademco 685 con espacios", () => assert.deepStrictEqual(cms.leer("01010 18 2989 E130 01 003"), { tipo: "evento", cuenta: "2989", datos: "1130 01 003" }));
prueba("Ademco con el dígito original del Contact ID", () => assert.strictEqual(cms.leer("0101 18 2989 3130 01 003").datos, "3130 01 003"));
prueba("con un campo agregado al final (número de serie)", () => assert.strictEqual(cms.leer("5011 182989E40101005 08202A78").datos, "1401 01 005"));
prueba("receptor 18 en el encabezado no se confunde", () => assert.strictEqual(cms.leer("5181 182989E40101005").cuenta, "2989"));
prueba("IPC10 real: robo zona 20 y su restauración", () => {
    assert.deepStrictEqual(cms.leer("15 2989 18 E130 01 U020"), { tipo: "evento", cuenta: "2989", datos: "1130 01 020" });
    const [e] = cod.traducirCid(cms.leer("15 2989 18 E130 01 U020").datos); assert.strictEqual(e.categoria, "ALARMA"); assert.strictEqual(e.zona, 20);
    assert.strictEqual(cod.traducirCid(cms.leer("15 2989 18 R130 01 U020").datos)[0].categoria, "RESTAURACION");
});
prueba("IPC10 real: evento del propio receptor (98)", () => assert.deepStrictEqual(cms.leer("15 0076c4250f 98 R314 00 U000"), { tipo: "evento", cuenta: "0076C4250F", datos: "3314 00 000" }));
prueba("IPC10: desarmado por el usuario 5", () => { const [e] = cod.traducirCid(cms.leer("15 2989 18 E401 01 U005").datos); assert.strictEqual(e.categoria, "DESARMADO"); assert.strictEqual(e.usuario, 5); });
prueba("latido Sur-Gard", () => assert.strictEqual(cms.leer("1011           @    ").tipo, "vivo"));
prueba("separar por DC4, CR y LF; lo incompleto queda", () => {
    const r = cms.separar("5011 182989E40101005\x14\n01010 18 2989 E130 01 003\r5011 18");
    assert.strictEqual(r.tramas.length, 2); assert.strictEqual(r.resto, "5011 18");
});
prueba("basura: ilegible", () => assert.strictEqual(cms.leer("GET / HTTP/1.1").tipo, "ilegible"));
console.log(`\n${ok} bien, ${mal} mal`); process.exit(mal ? 1 : 0);
