import test from "node:test";
import assert from "node:assert/strict";
import { normalizarAjustes, AJUSTES_POR_DEFECTO, TIPOS_POR_DEFECTO, serializarAvisos } from "../../src/lib/visitas/ajustes-base.ts";

test("sin nada cargado: los valores por defecto, modo CERRADO", () => {
    const a = normalizarAjustes({});
    assert.equal(a.modo, "CERRADO");
    assert.deepEqual(a.tipos, TIPOS_POR_DEFECTO);
    assert.equal(a.tipos.find((t) => t.clave === "DELIVERY")!.minutos, 15);
    assert.equal(a.horaCorte, "05:00");
});

test("JSON roto: no rompe, cae a los defaults", () => {
    const a = normalizarAjustes({ modo: "ABIERTO", tipos: "{no es json", avisos: "[[[" });
    assert.equal(a.modo, "ABIERTO");
    assert.deepEqual(a.tipos, TIPOS_POR_DEFECTO);
    assert.deepEqual(a.avisos, AJUSTES_POR_DEFECTO.avisos);
});

test("modo desconocido: CERRADO", () => {
    assert.equal(normalizarAjustes({ modo: "abierto" }).modo, "CERRADO");
});

test("valores fuera de rango se acotan", () => {
    const a = normalizarAjustes({
        tipos: JSON.stringify([{ clave: "delivery", nombre: "Delivery", minutos: 0 }, { clave: "obra", minutos: 99999 }, { clave: "delivery", minutos: 20 }]),
        avisos: JSON.stringify({ DA_VUELTAS: { activo: true, lecturas: 1, minutos: 1 }, horaCorte: "25:99", rutinaDiasMin: 1 }),
    });
    assert.equal(a.tipos.length, 2, "la clave repetida se descarta");
    assert.equal(a.tipos[0].minutos, 1);
    assert.equal(a.tipos[1].minutos, 24 * 60);
    assert.equal(a.avisos.DA_VUELTAS.lecturas, 2);
    assert.equal(a.avisos.DA_VUELTAS.minutos, 5);
    assert.equal(a.horaCorte, "05:00");
    assert.equal(a.rutinaDiasMin, 3);
});

test("serializar y volver a leer da lo mismo", () => {
    const a = normalizarAjustes({ avisos: JSON.stringify({ SIN_REGISTRAR: { activo: true }, horaCorte: "04:30" }) });
    const b = normalizarAjustes({ avisos: serializarAvisos(a) });
    assert.deepEqual(b.avisos, a.avisos);
    assert.equal(b.horaCorte, "04:30");
});
