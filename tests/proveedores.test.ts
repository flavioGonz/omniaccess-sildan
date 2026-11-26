/** Los proveedores del lote que entran por matrícula en sus días y horario (lib-proveedores, 26/11). */
import test from "node:test";
import assert from "node:assert/strict";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pv = require("../lib-proveedores.js");

// Fechas en hora de Montevideo (UTC-3, sin horario de verano): martes 1/12/2026.
const mvd = (iso: string) => new Date(`${iso}-03:00`);
const jardinero = { dias: ["mar", "vie"], desde: "08:00", hasta: "12:00" };

test("proveedores: entra en su día y en su horario, con media hora de margen", () => {
    assert.ok(pv.enHorario(jardinero, mvd("2026-12-01T09:00:00")), "martes 9:00");
    assert.ok(pv.enHorario(jardinero, mvd("2026-12-01T07:40:00")), "llega 20 minutos antes");
    assert.ok(pv.enHorario(jardinero, mvd("2026-12-01T12:25:00")), "se va un rato después");
    assert.ok(!pv.enHorario(jardinero, mvd("2026-12-01T07:00:00")), "una hora antes ya no");
    assert.ok(!pv.enHorario(jardinero, mvd("2026-12-01T15:00:00")), "a la tarde no");
});
test("proveedores: otro día de la semana no entra", () => {
    assert.ok(!pv.enHorario(jardinero, mvd("2026-12-02T09:00:00")), "miércoles");
    assert.ok(pv.enHorario(jardinero, mvd("2026-12-04T09:00:00")), "viernes sí");
});
test("proveedores: sin horas vale el día entero; sin días no entra nunca", () => {
    assert.ok(pv.enHorario({ dias: ["mar"] }, mvd("2026-12-01T21:00:00")));
    assert.ok(!pv.enHorario({ dias: [], desde: "08:00", hasta: "12:00" }, mvd("2026-12-01T09:00:00")));
});
test("proveedores: un horario que cruza la medianoche es del día en que empieza", () => {
    const sereno = { dias: ["lun"], desde: "22:00", hasta: "06:00" };
    assert.ok(pv.enHorario(sereno, mvd("2026-11-30T23:00:00")), "lunes 23:00");
    assert.ok(pv.enHorario(sereno, mvd("2026-12-01T02:00:00")), "martes 02:00 = la noche del lunes");
    assert.ok(!pv.enHorario(sereno, mvd("2026-12-02T02:00:00")), "miércoles 02:00 = la noche del martes, no");
});
test("proveedores: cuándo viene, en una línea", () => {
    assert.equal(pv.cuandoViene(jardinero), "mar, vie · 08:00 a 12:00");
});
