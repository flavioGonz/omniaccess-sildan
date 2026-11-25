import test from "node:test";
import assert from "node:assert/strict";
import { conexionDeCamara } from "@/lib/conexion-camaras";

const AHORA = Date.parse("2026-11-25T15:00:00Z");
const hace = (s: number) => new Date(AHORA - s * 1000).toISOString();
const proceso = { t: hace(5), cadaMs: 10_000 };

test("conexión de cámaras: contestó en la última vuelta → en línea", () => {
    assert.equal(conexionDeCamara({ ultimo: hace(8), error: null }, proceso, AHORA).estado, "en-linea");
});
test("conexión de cámaras: no contesta → sin conexión, desde la primera falla", () => {
    const c = conexionDeCamara({ ultimo: hace(600), error: "no contesta", caidaDesde: hace(590) }, proceso, AHORA);
    assert.equal(c.estado, "sin-conexion");
    assert.equal(c.desde, hace(590));
});
test("conexión de cámaras: sin respuesta hace varias vueltas aunque no haya error anotado → sin conexión", () => {
    assert.equal(conexionDeCamara({ ultimo: hace(45), error: null }, proceso, AHORA).estado, "sin-conexion");
});
test("conexión de cámaras: el proceso que pregunta está parado → no se sabe (no «en línea»)", () => {
    assert.equal(conexionDeCamara({ ultimo: hace(8), error: null }, { t: hace(300), cadaMs: 10_000 }, AHORA).estado, "sin-copiar");
    assert.equal(conexionDeCamara({ ultimo: hace(8), error: null }, null, AHORA).estado, "sin-copiar");
});
test("conexión de cámaras: una que no es LPR no cuenta como caída", () => {
    assert.equal(conexionDeCamara({ ultimo: null, error: "sin registro de lecturas (HTTP 400)" }, proceso, AHORA).estado, "sin-registro");
});
