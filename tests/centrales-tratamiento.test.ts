/** Lo que configura el administrador para tratar eventos de central (lib/centrales/tratamiento-tipos). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CIERRES_DEFECTO, ESCALADO_DEFECTO, PROCEDIMIENTO_DEFECTO, leerCierres, leerEscalado, leerProcedimiento, leerProcedimientosClase, obligatoriosFaltantes, origenProcedimiento, resolverProcedimiento, segATexto } from "@/lib/centrales/tratamiento-tipos";

test("cierres: lo de fábrica tiene los ejemplos de Nico", () => {
    assert.ok(CIERRES_DEFECTO.some((c) => /Usuario probando/.test(c.texto) && c.resultado === "falsa"));
    assert.ok(CIERRES_DEFECTO.some((c) => /policía/.test(c.texto) && c.resultado === "real"));
});
test("cierres: vacíos afuera, ids únicos, resultado desconocido = otro, vacío = fábrica", () => {
    const c = leerCierres([{ texto: "Hola mundo" }, { texto: "Hola mundo" }, { texto: "  " }, { id: "x", texto: "Robo", resultado: "real" }, { texto: "Raro", resultado: "cualquiera" }]);
    assert.equal(c.length, 4);
    assert.equal(new Set(c.map((x) => x.id)).size, 4);
    assert.equal(c[3].resultado, "otro");
    assert.deepEqual(leerCierres("[]"), CIERRES_DEFECTO);
});
test("procedimiento y escalado: lo inválido vuelve a fábrica; el aviso nunca por debajo de la ventana", () => {
    const p = leerProcedimiento({ "1": ["A", "", "B"], "9": ["x"] });
    assert.deepEqual(p["1"], [{ texto: "A", obligatorio: false }, { texto: "B", obligatorio: false }]);
    const e = leerEscalado({ ventanaHasta: 3, avisoHasta: 1, tomarMin: -5 });
    assert.equal(e.ventanaHasta, 3); assert.equal(e.avisoHasta, 3); assert.equal(e.tomarMin, ESCALADO_DEFECTO.tomarMin);
});
test("tiempos en palabras", () => { assert.equal(segATexto(42), "42 s"); assert.equal(segATexto(190), "3 min 10 s"); assert.equal(segATexto(null), "—"); });

test("procedimiento: lo guardado como texto suelto (antes del 23/10) se lee como no obligatorio; repetidos afuera; tope 12", () => {
    const p = leerProcedimiento({ "2": ["Mirar", { texto: "Llamar", obligatorio: true }, "Mirar"], "3": Array.from({ length: 20 }, (_, i) => `Paso ${i}`) });
    assert.deepEqual(p["2"], [{ texto: "Mirar", obligatorio: false }, { texto: "Llamar", obligatorio: true }]);
    assert.equal(p["3"].length, 12);
    assert.deepEqual(p["4"], PROCEDIMIENTO_DEFECTO["4"]);
});

test("procedimiento por clase: con lista propia manda la clase; null o ausente, la prioridad", () => {
    const porClase = leerProcedimientosClase({ INCENDIO: [{ texto: "Llamar a bomberos (104)", obligatorio: true }], ROBO: null, DESCONOCIDA: ["x"] });
    assert.deepEqual(Object.keys(porClase), ["INCENDIO"]);
    const inc = resolverProcedimiento("INCENDIO", "Incendio", 1, PROCEDIMIENTO_DEFECTO, porClase);
    assert.equal(inc.pasos[0].texto, "Llamar a bomberos (104)");
    assert.equal(origenProcedimiento(inc), "Procedimiento de Incendio");
    const robo = resolverProcedimiento("ROBO", "Robo", 1, PROCEDIMIENTO_DEFECTO, porClase);
    assert.deepEqual(robo.pasos, PROCEDIMIENTO_DEFECTO["1"]);
    assert.equal(origenProcedimiento(robo), "Procedimiento de prioridad 1");
    // Una clase con lista vacía a propósito no tiene pasos (no cae a la prioridad).
    assert.deepEqual(resolverProcedimiento("FALLA", "Fallos", 4, PROCEDIMIENTO_DEFECTO, { FALLA: [] }).pasos, []);
});

test("obligatorios: tratar exige hacerlos o saltearlos", () => {
    const pasos = [{ texto: "Mirar las cámaras", obligatorio: true }, { texto: "Llamar al titular", obligatorio: true }, { texto: "Enviar a la guardia", obligatorio: false }];
    assert.deepEqual(obligatoriosFaltantes(pasos, {}, {}), ["Mirar las cámaras", "Llamar al titular"]);
    assert.deepEqual(obligatoriosFaltantes(pasos, { "Mirar las cámaras": {} }, {}), ["Llamar al titular"]);
    assert.deepEqual(obligatoriosFaltantes(pasos, { "Mirar las cámaras": {} }, { "Llamar al titular": { motivo: "El titular está con la guardia" } }), []);
});
