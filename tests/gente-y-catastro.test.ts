/** La gente de un lote, igual en la lista que en su cajón; y el mapa, que ya no inventa unidades (28/11). */
import test from "node:test";
import assert from "node:assert/strict";
import { genteDelLote } from "@/lib/gente-de-lote";
import { atarDibujos, codigoDeRotulo } from "@/lib/catastro-desde-lotes";

test("gente del lote: cuenta a quien tiene vínculo y a quien sólo lo tiene como lote principal", () => {
    const ana = { id: "a", name: "Ana" }, beto = { id: "b", name: "Beto" }, cata = { id: "c", name: "Cata" };
    const g = genteDelLote([{ vinculo: "PROPIETARIO", user: ana }, { vinculo: "FAMILIA", user: beto }], [ana, cata]);
    assert.deepEqual(g.map((x) => [x.persona.id, x.vinculo]), [["a", "PROPIETARIO"], ["b", "FAMILIA"], ["c", ""]], "Ana no se repite; a Cata no se le inventa un vínculo");
    assert.deepEqual(genteDelLote([], []), []);
});

test("mapa: el rótulo de un dibujo dice el código del lote, se escriba como se escriba", () => {
    for (const r of ["L3", "L 3", "l-3", "Lote L 3", "LOTE L3", "L 3 (1-3)"]) assert.equal(codigoDeRotulo(r), "L3", r);
    assert.equal(codigoDeRotulo("Lote 12"), "12");
    assert.equal(codigoDeRotulo("NICO San Luis"), "NICOSANLUIS", "un nombre libre no es el código de ningún lote");
    assert.equal(codigoDeRotulo(""), "");
});

test("mapa: un dibujo se ata solo únicamente cuando hay un lote con ese código, y uno solo", () => {
    const padron = [{ id: "u3", nombre: "L 3 (1-3)" }, { id: "u1a", nombre: "L 1 (1-3)" }, { id: "u1b", nombre: "L 1 (4-5)" }, { id: "u4", nombre: "L 4 (1-3)" }];
    const r = atarDibujos(
        [{ id: "d3", rotulo: "L3" }, { id: "d1", rotulo: "L1" }, { id: "dn", rotulo: "NICO San Luis" }, { id: "d4", rotulo: "Lote L 4" }, { id: "d3b", rotulo: "L 3" }, { id: "dv", rotulo: "" }],
        padron, new Set(["u4"]),
    );
    assert.deepEqual(r.atados, { d3: "u3" });
    assert.deepEqual(r.sinLote, ["d1", "dn", "d4", "d3b", "dv"], "L1 está en dos etapas; el nombre libre no existe; L4 ya tiene dibujo; el segundo L3 llega tarde; el vacío no es nada");
});
