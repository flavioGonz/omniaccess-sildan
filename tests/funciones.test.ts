/** Funciones de la instalación (openspec alarmas-como-funciones): dependencia y estado efectivo. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FUNCIONES, FUNCIONES_INSTALACION, dependenciaCumplida, estadoEfectivo, funcionPorId } from "@/lib/funciones";

test("las tres funciones de la instalación no cuelgan de ningún modo", () => {
    const ids = FUNCIONES_INSTALACION().map((f) => f.id).sort();
    assert.deepEqual(ids, ["FUNC_ALARMAS_GESTION", "FUNC_ALARMAS_RECEPCION", "FUNC_INTRUSION"]);
    for (const f of FUNCIONES_INSTALACION()) assert.equal(f.modulo, undefined);
    for (const f of FUNCIONES.filter((x) => x.alcance === "modulo")) assert.ok(f.modulo, `${f.id} sin módulo`);
});

test("defectos: Intrusión prendida, alarmas apagadas (instalación nueva)", () => {
    assert.equal(estadoEfectivo("FUNC_INTRUSION", {}), true);
    assert.equal(estadoEfectivo("FUNC_ALARMAS_RECEPCION", {}), false);
    assert.equal(estadoEfectivo("FUNC_ALARMAS_GESTION", {}), false);
});

test("gestión sin recepción no vale, y vuelve sola al prender la recepción", () => {
    const g = funcionPorId("FUNC_ALARMAS_GESTION")!;
    assert.equal(dependenciaCumplida(g, { FUNC_ALARMAS_RECEPCION: false }), false);
    assert.equal(estadoEfectivo("FUNC_ALARMAS_GESTION", { FUNC_ALARMAS_GESTION: true, FUNC_ALARMAS_RECEPCION: false }), false);
    assert.equal(estadoEfectivo("FUNC_ALARMAS_GESTION", { FUNC_ALARMAS_GESTION: true, FUNC_ALARMAS_RECEPCION: true }), true);
    assert.equal(estadoEfectivo("FUNC_ALARMAS_RECEPCION", { FUNC_ALARMAS_RECEPCION: true, FUNC_ALARMAS_GESTION: false }), true);
});

test("las de matrículas siguen igual", () => {
    assert.equal(estadoEfectivo("LPR_OCUPACION", { LPR_ESTADIAS: false }), false);
    assert.equal(estadoEfectivo("LPR_MARCAS", {}), false);
});

test("los avisos de central no dependen de la función Intrusión", async () => {
    const { esAvisoDeCamara } = await import("@/lib/funciones");
    assert.equal(esAvisoDeCamara({ modulo: "INTRUSION", evento: "LINECROSS" }), true);
    assert.equal(esAvisoDeCamara({ modulo: "INTRUSION", evento: "INTRUSION" }), true);
    assert.equal(esAvisoDeCamara({ modulo: "INTRUSION", evento: "CENTRAL" }), false);
    assert.equal(esAvisoDeCamara({ modulo: "INTRUSION", evento: "CENTRAL_ESCALADO" }), false);
    assert.equal(esAvisoDeCamara({ modulo: "LPR", evento: "DENIED" }), false);
});
