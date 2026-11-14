/** Cuándo cambió de estado una analítica entrenable de escena (lib/zona-evento): el aviso sale después; el hecho, antes. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cambioDeEstado, tiraDelCambio, cajaDePoligono, poligonoValido } from "@/lib/zona-evento";

const MIN = 60_000;
const serie = (probs: number[], cada = 5 * MIN, t0 = 1_000_000) => probs.map((prob, i) => ({ id: `m${i}`, ts: t0 + i * cada, prob }));

test("encuentra entre qué dos miradas cambió, no la hora del aviso", () => {
    const m = serie([0.1, 0.12, 0.08, 0.9, 0.93, 0.95, 0.97, 0.96]);
    const c = cambioDeEstado(m, 0.6, m[7].ts);
    assert.equal(c.antes?.id, "m2");
    assert.equal(c.desde?.id, "m3");
    assert.equal(c.evento?.id, "m7");
});
test("una mirada entre el umbral y la histéresis no corta el tramo ni lo empieza", () => {
    // 0,5 está bajo el umbral (0,6) pero sobre 0,45: el worker no reinicia la cuenta.
    const m = serie([0.1, 0.7, 0.5, 0.8, 0.9]);
    const c = cambioDeEstado(m, 0.6, m[4].ts);
    assert.equal(c.desde?.id, "m1");
    assert.equal(c.antes?.id, "m0");
    // Y al revés: si el tramo arranca con una intermedia, el estado empezó en la primera que llegó al umbral.
    const n = serie([0.1, 0.5, 0.7, 0.9]);
    const d = cambioDeEstado(n, 0.6, n[3].ts);
    assert.equal(d.desde?.id, "m2");
    assert.equal(d.antes?.id, "m1");
});
test("una bajada de verdad corta: el cambio es el de la última subida", () => {
    const m = serie([0.9, 0.9, 0.1, 0.2, 0.8, 0.9]);
    const c = cambioDeEstado(m, 0.6, m[5].ts);
    assert.equal(c.desde?.id, "m4");
    assert.equal(c.antes?.id, "m3");
});
test("si la historia no llega al cambio, no inventa un «antes»", () => {
    const m = serie([0.9, 0.92, 0.95]);
    const c = cambioDeEstado(m, 0.6, m[2].ts);
    assert.equal(c.desde?.id, "m0");
    assert.equal(c.antes, null);
});
test("no mira muestras posteriores al evento, y tolera unos segundos de desfase", () => {
    const m = serie([0.1, 0.9, 0.9, 0.1]);
    const c = cambioDeEstado(m, 0.6, m[2].ts - 2000);
    assert.equal(c.evento?.id, "m2");
    assert.equal(cambioDeEstado([], 0.6, 1).evento, null);
    assert.equal(cambioDeEstado(serie([0.1, 0.2]), 0.6, 9e15).desde, null);
});

test("deja las últimas normales, el cambio, algunas del tramo y la del aviso", () => {
    const m = serie([0.1, 0.1, 0.1, 0.1, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.95]);
    const t = tiraDelCambio(m, cambioDeEstado(m, 0.6, m[14].ts), 8);
    assert.equal(t.length, 8);
    assert.deepEqual(t.map((x) => x.rol), ["antes", "antes", "cambio", "durante", "durante", "durante", "durante", "evento"]);
    assert.equal(t[0].id, "m2"); assert.equal(t[2].id, "m4"); assert.equal(t[7].id, "m14");
    assert.equal(new Set(t.map((x) => x.id)).size, 8);
});
test("con pocas miradas las muestra todas, una vez", () => {
    const m = serie([0.1, 0.9, 0.95]);
    const t = tiraDelCambio(m, cambioDeEstado(m, 0.6, m[2].ts));
    assert.deepEqual(t.map((x) => `${x.id}:${x.rol}`), ["m0:antes", "m1:cambio", "m2:evento"]);
    const u = serie([0.1, 0.9]);
    assert.deepEqual(tiraDelCambio(u, cambioDeEstado(u, 0.6, u[1].ts)).map((x) => x.rol), ["antes", "evento"]);
});

test("valida y envuelve", () => {
    assert.equal(poligonoValido([[0.1, 0.2], [0.5, 0.2], [0.5, 0.9]])?.length, 3);
    assert.equal(poligonoValido([[0.1, 0.2], [0.5, 0.2]]), null);
    assert.equal(poligonoValido("Vigía"), null);
    assert.equal(poligonoValido([[0.1, 0.2], ["x", 1], [0.5, 0.9]]), null);
    assert.deepEqual(cajaDePoligono([[0.1, 0.2], [0.5, 0.3], [0.4, 0.9]]), [0.1, 0.2, 0.5, 0.9]);
});
