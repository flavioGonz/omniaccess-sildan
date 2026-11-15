import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPAS_DEFECTO, leerCapas, objetosVisibles, pideAnalisis } from "@/lib/capas-visibles";

const escena = [
    { grupo: "persona", n: 1 }, { grupo: "vehiculo", n: 2, chapa: { plate: "ABC1234" } }, { grupo: "vehiculo", n: 3 },
    { grupo: "animal", n: 4 }, { grupo: "propio", n: 5 },
];

test("de fábrica se ve todo lo de OmniVision; las zonas de las analíticas, no", () => {
    assert.equal(objetosVisibles(escena, CAPAS_DEFECTO).length, 5);
    assert.equal(CAPAS_DEFECTO.zonas, false);
});

test("sólo personas: lo demás no se dibuja", () => {
    const r = objetosVisibles(escena, { ...CAPAS_DEFECTO, vehiculo: false, animal: false, propio: false, chapas: false });
    assert.deepEqual(r.map((o) => o.n), [1]);
});

test("sólo matrículas: el vehículo con chapa queda, pero oculto (sin silueta ni rótulo)", () => {
    const r = objetosVisibles(escena, { ...CAPAS_DEFECTO, persona: false, vehiculo: false, animal: false, propio: false });
    assert.deepEqual(r.map((o) => [o.n, o.oculto]), [[2, true]]);
});

test("vehículos sin matrículas: la silueta sí, la chapa no", () => {
    const r = objetosVisibles(escena, { ...CAPAS_DEFECTO, chapas: false });
    assert.equal(r.length, 5);
    assert.ok(r.every((o) => !("chapa" in o) || o.chapa == null));
    assert.ok("chapa" in escena[1], "no se toca lo que llegó");
});

test("con todas las capas de OmniVision apagadas no se le pide nada", () => {
    const nada = { ...CAPAS_DEFECTO, persona: false, vehiculo: false, animal: false, propio: false, chapas: false };
    assert.equal(pideAnalisis(nada), false);
    assert.equal(pideAnalisis({ ...nada, propio: true }), true);
    assert.equal(pideAnalisis({ ...nada, chapas: true }), true, "en el vivo, las matrículas salen del análisis");
    assert.equal(pideAnalisis({ ...nada, chapas: true }, false), false, "en la grabación no hay matrículas");
    assert.equal(pideAnalisis({ ...nada, zonas: true, camara: true }), false);
});

test("lo guardado roto o de otra versión se completa de fábrica", () => {
    assert.deepEqual(leerCapas(null), CAPAS_DEFECTO);
    assert.deepEqual(leerCapas("{"), CAPAS_DEFECTO);
    assert.deepEqual(leerCapas(JSON.stringify({ vehiculo: false, zonas: "si", otra: true })), { ...CAPAS_DEFECTO, vehiculo: false });
});
