/** Lo que configura el administrador para tratar eventos de central (lib/centrales/tratamiento-tipos). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CIERRES_DEFECTO, ESCALADO_DEFECTO, leerCierres, leerEscalado, leerProcedimiento, segATexto } from "@/lib/centrales/tratamiento-tipos";

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
    assert.deepEqual(p["1"], ["A", "B"]);
    const e = leerEscalado({ ventanaHasta: 3, avisoHasta: 1, tomarMin: -5 });
    assert.equal(e.ventanaHasta, 3); assert.equal(e.avisoHasta, 3); assert.equal(e.tomarMin, ESCALADO_DEFECTO.tomarMin);
});
test("tiempos en palabras", () => { assert.equal(segATexto(42), "42 s"); assert.equal(segATexto(190), "3 min 10 s"); assert.equal(segATexto(null), "—"); });
