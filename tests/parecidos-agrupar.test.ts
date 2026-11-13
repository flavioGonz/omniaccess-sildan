/** Lo repetido en una sola tarjeta: misma cámara y huella casi idéntica (lib/parecidos-agrupar). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparRepetidos } from "@/lib/parecidos-agrupar";

// Huellas de 4 números: `a` y `a2` casi iguales; `b` distinta.
const a = Int8Array.from([100, 10, 0, 0]), a2 = Int8Array.from([99, 12, 1, 0]), b = Int8Array.from([10, 100, 0, 0]);
const c = (id: string, coseno: number, camara: string | null, v: Int8Array) => ({ id, coseno, camara, v });

test("misma cámara y casi la misma huella: una tarjeta, con cuántas veces", () => {
    const r = agruparRepetidos([c("1", 0.9, "cam1", a), c("2", 0.89, "cam1", a2), c("3", 0.8, "cam1", b), c("4", 0.7, "cam1", a2)], 60);
    assert.deepEqual(r.map((x) => [x.id, x.veces]), [["1", 3], ["3", 1]]);
    assert.deepEqual(r[0].repetidos, ["2", "4"]);
});

test("en otra cámara no se agrupa: ahí la coincidencia es el hallazgo", () => {
    const r = agruparRepetidos([c("1", 0.9, "cam1", a), c("2", 0.89, "cam2", a2), c("3", 0.88, null, a), c("4", 0.87, null, a)], 60);
    assert.deepEqual(r.map((x) => x.id), ["1", "2", "3", "4"]);
});

test("lo que sacan los repetidos lo ocupan candidatos distintos, y el orden no cambia", () => {
    const lista = [c("1", 0.9, "cam1", a), c("2", 0.89, "cam1", a2), c("3", 0.88, "cam1", a2), c("4", 0.5, "cam1", b), c("5", 0.4, "cam2", b)];
    const r = agruparRepetidos(lista, 2);
    assert.deepEqual(r.map((x) => x.id), ["1", "4"]);
    // Lleno, se siguen contando los repetidos de lo que quedó pero no entran tarjetas nuevas.
    assert.equal(r[0].veces, 3);
});
