/** La chapa de un vehículo quieto es la más leída (lib/votos-chapa). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ganadora, leerVotos, votar, votosIniciales } from "@/lib/votos-chapa";

test("gana la más leída, aunque otra haya llegado antes con la misma confianza", () => {
    let v = votosIniciales("SCH1707", 2, 0.9);
    for (let i = 0; i < 5; i++) v = votar(v, "SDH1707", 1, 0.9);
    v = votar(v, "SDM1707", 2, 0.9);
    assert.equal(ganadora(v, "SCH1707"), "SDH1707");
    assert.deepEqual(v.SDH1707, { n: 5, c: 4.5 });
});

test("empate en lecturas: decide la confianza acumulada; empate total: queda la que estaba", () => {
    assert.equal(ganadora({ A1: { n: 3, c: 2.1 }, B1: { n: 3, c: 2.7 } }, "A1"), "B1");
    assert.equal(ganadora({ A1: { n: 3, c: 2.7 }, B1: { n: 3, c: 2.7 } }, "B1"), "B1");
    assert.equal(ganadora({ A1: { n: 3, c: 2.7 }, B1: { n: 3, c: 2.7 } }, "A1"), "A1");
    // La fila tenía una chapa que no está entre los votos (vino de antes): gana la más votada.
    assert.equal(ganadora({ A1: { n: 1, c: 0.9 } }, "ZZ9"), "A1");
});

test("una lectura vista en cinco cuadros pesa cinco; sin datos, uno", () => {
    assert.deepEqual(votar(null, "A1", 5, 0.8), { A1: { n: 5, c: 4 } });
    assert.deepEqual(votar(null, "A1"), { A1: { n: 1, c: 0 } });
});

test("no crece sin fin: se cae la de menos votos, nunca la recién leída", () => {
    let v = votar(null, "FIJA", 50, 0.9);
    for (let i = 0; i < 30; i++) v = votar(v, `X${i}`, 1, 0.5);
    assert.equal(Object.keys(v).length, 12);
    assert.ok(v.FIJA && v.X29);
});

test("lo guardado que no sirve es «sin votos»", () => {
    assert.equal(leerVotos(null), null);
    assert.equal(leerVotos("x"), null);
    assert.equal(leerVotos({ A1: { n: 0, c: 1 } }), null);
    assert.deepEqual(leerVotos({ A1: { n: 2, c: 1.8 }, B: "x" }), { A1: { n: 2, c: 1.8 } });
});
