import test from "node:test";
import assert from "node:assert/strict";
import { fotosQueSirven, muestrasQueSirven, ORIGEN_ZONA, TOPE_TRAER, type FotoDelConjunto } from "@/lib/fotos-compartidas";

const f = (id: string, deviceId: string | null, dia: string, origen = "CAMARA"): FotoDelConjunto =>
    ({ id, deviceId, origen, createdAt: `2026-11-${dia}T10:00:00.000Z` });

test("sólo las fotos de la cámara de la zona", () => {
    const r = fotosQueSirven([f("a", "cam1", "10"), f("b", "cam2", "11"), f("c", null, "12")], "cam1");
    assert.deepEqual(r.map((x) => x.id), ["a"]);
});

test("de la más nueva a la más vieja", () => {
    const r = fotosQueSirven([f("vieja", "cam1", "01"), f("nueva", "cam1", "15"), f("media", "cam1", "09")], "cam1");
    assert.deepEqual(r.map((x) => x.id), ["nueva", "media", "vieja"]);
});

test("no se trae dos veces la misma foto", () => {
    const r = fotosQueSirven([f("a", "cam1", "10"), f("b", "cam1", "11")], "cam1", ["b"]);
    assert.deepEqual(r.map((x) => x.id), ["a"]);
});

test("un recorte que salió de una zona no vuelve a entrar como muestra", () => {
    const r = fotosQueSirven([f("a", "cam1", "10", ORIGEN_ZONA), f("b", "cam1", "11")], "cam1");
    assert.deepEqual(r.map((x) => x.id), ["b"]);
});

test("se traen de a tandas", () => {
    const muchas = Array.from({ length: TOPE_TRAER + 10 }, (_, i) => f(`f${i}`, "cam1", "10"));
    assert.equal(fotosQueSirven(muchas, "cam1").length, TOPE_TRAER);
    assert.equal(fotosQueSirven(muchas, "cam1", [], 5).length, 5);
});

test("una muestra que vino de una foto no se manda de vuelta al conjunto", () => {
    const r = muestrasQueSirven([{ id: "propia" }, { id: "traida", fotoId: "f1" }]);
    assert.deepEqual(r.map((x) => x.id), ["propia"]);
});

test("la etiqueta de la zona no decide: un «normal» también sirve de negativo", () => {
    const r = muestrasQueSirven([{ id: "p", etiqueta: "pos" }, { id: "n", etiqueta: "neg" }, { id: "s", etiqueta: null }]);
    assert.equal(r.length, 3);
});
