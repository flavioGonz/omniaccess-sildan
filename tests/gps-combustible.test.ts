import test from "node:test";
import assert from "node:assert/strict";
import { nivelDelTanque, rendimiento } from "@/lib/gps-combustible";

const SIN = { capacidad: null, llenoEn: null, llenoCuando: null };

test("si el vehículo informa su nivel, manda ese: en porcentaje o en litros", () => {
    assert.deepEqual(nivelDelTanque({ combustible: 62 }, SIN), { fuente: "vehiculo", pct: 62, litros: null, desde: null, falta: null });
    // Con la capacidad cargada, el porcentaje se dice también en litros.
    assert.equal(nivelDelTanque({ combustible: 50 }, { ...SIN, capacidad: 66 }).litros, 33);
    const l = nivelDelTanque({ combustibleL: 40 }, { ...SIN, capacidad: 80 });
    assert.equal(l.fuente, "vehiculo"); assert.equal(l.litros, 40); assert.equal(l.pct, 50);
    // Y aunque haya una estimación posible, no la usa.
    assert.equal(nivelDelTanque({ combustible: 62, consumido: 30 }, { capacidad: 66, llenoEn: 10, llenoCuando: "x" }).fuente, "vehiculo");
});

test("si no lo informa, se estima: capacidad menos lo quemado desde que se llenó", () => {
    const n = nivelDelTanque({ consumido: 112.4 }, { capacidad: 66, llenoEn: 100, llenoCuando: "2026-11-20T10:00:00.000Z" });
    assert.equal(n.fuente, "estimado"); assert.equal(n.litros, 53.6); assert.equal(n.pct, 81); assert.equal(n.desde, "2026-11-20T10:00:00.000Z");
    // No baja de cero: quemó más de lo que entra (cargó y nadie lo anotó).
    assert.equal(nivelDelTanque({ consumido: 200 }, { capacidad: 66, llenoEn: 100, llenoCuando: null }).litros, 0);
});

test("dice qué falta para poder estimarlo, en vez de inventar un nivel", () => {
    assert.match(nivelDelTanque({ consumido: 5 }, SIN).falta!, /cuántos litros/);
    assert.match(nivelDelTanque({ consumido: 5 }, { ...SIN, capacidad: 66 }).falta!, /Tanque lleno/);
    assert.match(nivelDelTanque({}, { capacidad: 66, llenoEn: 3, llenoCuando: null }).falta!, /todavía no informó/);
    assert.match(nivelDelTanque(null, { capacidad: 0, llenoEn: null, llenoCuando: null }).falta!, /cuántos litros/);
    // Un contador que volvió a empezar (se cambió el equipo): no se estima sobre un número negativo.
    const r = nivelDelTanque({ consumido: 2 }, { capacidad: 66, llenoEn: 100, llenoCuando: "x" });
    assert.equal(r.fuente, "sin-dato"); assert.match(r.falta!, /volvió a empezar/);
});

test("el rendimiento no se da con pocos kilómetros", () => {
    assert.equal(rendimiento(0.5, 3), null);          // 700 metros y un rato regulando: 17 l/100 km no dice nada
    assert.equal(rendimiento(45, 500), 9);
    assert.equal(rendimiento(null, 500), null); assert.equal(rendimiento(10, null), null);
});
