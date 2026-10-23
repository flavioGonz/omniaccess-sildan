/** Retención de las fotos de las alarmas de central (bucket propio): lo guardado se acota. */
import { test } from "node:test";
import assert from "node:assert/strict";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const r = require("../lib-retencion-alarmas.js");

test("sin dato o basura: los valores por defecto", () => {
    assert.equal(r.diasValidos(undefined), r.DIAS_DEFECTO);
    assert.equal(r.diasValidos("abc"), r.DIAS_DEFECTO);
    assert.equal(r.topeValido(null), r.TOPE_GB_DEFECTO);
    assert.equal(r.topeValido(-3), r.TOPE_GB_DEFECTO);
});

test("se acota a los límites", () => {
    assert.equal(r.diasValidos(1), r.DIAS_MIN);
    assert.equal(r.diasValidos(99999), r.DIAS_MAX);
    assert.equal(r.topeValido(100000), r.TOPE_GB_MAX);
    assert.equal(r.diasValidos("45"), 45);
});

test("leerRetencion usa lo guardado", async () => {
    const prisma = { setting: { findMany: async () => [{ key: r.AJUSTE_DIAS, value: "30" }, { key: r.AJUSTE_TOPE_GB, value: "5" }] } };
    assert.deepEqual(await r.leerRetencion(prisma), { dias: 30, topeGb: 5 });
});
