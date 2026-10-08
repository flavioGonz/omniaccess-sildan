import test from "node:test";
import assert from "node:assert/strict";
import { presentarLectura, rotulosContadores, motivo } from "../../src/lib/visitas/presentacion.ts";

test("ABIERTO nunca dice Permitido ni Denegado", () => {
    for (const decision of ["GRANT", "DENY", null]) for (const registrada of [true, false]) {
        const p = presentarLectura({ modo: "ABIERTO", decision, registrada, listaNegra: false });
        assert.ok(!/permitido|denegado/i.test(p.texto), `${decision}/${registrada} → ${p.texto}`);
    }
    assert.equal(presentarLectura({ modo: "ABIERTO", decision: "DENY", registrada: false, listaNegra: false }).tono, "neutro");
    assert.equal(presentarLectura({ modo: "ABIERTO", decision: "DENY", registrada: true, listaNegra: false }).texto, "Registrado");
});

test("CERRADO como siempre", () => {
    assert.equal(presentarLectura({ modo: "CERRADO", decision: "GRANT", registrada: true, listaNegra: false }).texto, "Permitido");
    assert.equal(presentarLectura({ modo: "CERRADO", decision: "DENY", registrada: false, listaNegra: false }).texto, "Denegado");
});

test("lista negra en los dos modos", () => {
    for (const modo of ["ABIERTO", "CERRADO"] as const) assert.equal(presentarLectura({ modo, decision: "GRANT", registrada: true, listaNegra: true }).texto, "Lista negra");
});

test("contadores y motivos", () => {
    assert.equal(rotulosContadores("ABIERTO").rechazos, "No registrados hoy");
    assert.equal(rotulosContadores("CERRADO").rechazos, "Denegados hoy");
    assert.match(motivo.fueraDeRutina({ hora: "03:10", rutina: "lun a vie · 06:50 ±2 min", por: "dia" }), /su rutina es lun a vie · 06:50 ±2 min/);
});
