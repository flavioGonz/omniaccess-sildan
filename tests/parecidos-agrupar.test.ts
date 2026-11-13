/** Lo repetido en una sola tarjeta: misma cámara, misma caja y huella casi idéntica (lib/parecidos-agrupar). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparRepetidos, solape } from "@/lib/parecidos-agrupar";

// Huellas de 4 números: `a` y `a2` casi iguales; `b` distinta. Cajas: `aca` y `aca2` casi la misma; `alla`, otra.
const a = Int8Array.from([100, 10, 0, 0]), a2 = Int8Array.from([99, 12, 1, 0]), b = Int8Array.from([10, 100, 0, 0]);
const aca = [0.2, 0.2, 0.6, 0.6], aca2 = [0.2, 0.205, 0.6, 0.6], alla = [0.5, 0.2, 0.9, 0.6];
const c = (id: string, coseno: number, camara: string | null, v: Int8Array, caja: number[] | null = aca, fija = true) => ({ id, coseno, camara, v, caja, fija });

test("misma cámara, misma caja y casi la misma huella: una tarjeta, con cuántas veces", () => {
    const r = agruparRepetidos([c("1", 0.9, "cam1", a), c("2", 0.89, "cam1", a2, aca2), c("3", 0.8, "cam1", b), c("4", 0.7, "cam1", a2)], 60);
    assert.deepEqual(r.map((x) => [x.id, x.veces]), [["1", 3], ["3", 1]]);
    assert.deepEqual(r[0].repetidos, ["2", "4"]);
});

test("no se agrupa: en otra cámara, en otra caja, sin caja, ni en una cámara de acceso", () => {
    assert.deepEqual(agruparRepetidos([c("1", 0.9, "cam1", a), c("2", 0.89, "cam2", a2)], 60).map((x) => x.id), ["1", "2"], "otra cámara");
    assert.deepEqual(agruparRepetidos([c("1", 0.9, "cam1", a), c("2", 0.89, "cam1", a2, alla)], 60).map((x) => x.id), ["1", "2"], "se movió");
    assert.deepEqual(agruparRepetidos([c("1", 0.9, "cam1", a), c("2", 0.89, "cam1", a2, null)], 60).map((x) => x.id), ["1", "2"], "sin caja");
    assert.deepEqual(agruparRepetidos([c("1", 0.9, "cam1", a, aca, false), c("2", 0.89, "cam1", a2, aca, false)], 60).map((x) => x.id), ["1", "2"], "acceso: cada pista es otro vehículo");
});

test("lo que sacan los repetidos lo ocupan candidatos distintos, y el orden no cambia", () => {
    const lista = [c("1", 0.9, "cam1", a), c("2", 0.89, "cam1", a2), c("3", 0.88, "cam1", a2), c("4", 0.5, "cam1", b), c("5", 0.4, "cam2", b)];
    const r = agruparRepetidos(lista, 2);
    assert.deepEqual(r.map((x) => x.id), ["1", "4"]);
    assert.equal(r[0].veces, 3);
});

test("solape: la misma caja 1, cajas que no se tocan 0", () => {
    assert.equal(solape(aca, aca), 1);
    assert.equal(solape([0, 0, 0.1, 0.1], [0.5, 0.5, 0.6, 0.6]), 0);
    assert.ok(solape(aca, aca2) > 0.95);
});
