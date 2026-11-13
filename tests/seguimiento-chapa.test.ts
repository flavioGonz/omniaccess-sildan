/** «Seguirlo»: la historia de una matrícula, armada con sus estadías, pasos y lecturas (lib/seguimiento-chapa). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { armarSeguimiento, cuantoDuro, motivoDePartida, puedeSerLaMisma, type Hecho } from "@/lib/seguimiento-chapa";

const MIN = 60_000, T0 = Date.UTC(2026, 10, 13, 1, 0);
const h = (tipo: Hecho["tipo"], id: string, plate: string, cam: string, desdeMin: number, hastaMin = desdeMin, extra: Partial<Hecho> = {}): Hecho =>
    ({ tipo, id, plate, deviceId: cam, camara: cam, desde: T0 + desdeMin * MIN, hasta: T0 + hastaMin * MIN, ...extra });

test("el auto quieto leído con tres chapas es UNA estadía, con cómo se la leyó", () => {
    const s = armarSeguimiento("SCH1707", [
        h("estadia", "1", "SDH1707", "cairoli", 0, 300), h("estadia", "2", "SCH1707", "cairoli", 310, 600),
        h("estadia", "3", "SDM1707", "cairoli", 610, 900), h("estadia", "4", "SDH1707", "cairoli", 905, 1100, { abierta: true }),
    ]);
    assert.equal(s.tramos.length, 1);
    assert.equal(s.estado, "esta");
    assert.equal(s.actual?.desde, T0);
    assert.equal(s.actual?.hasta, T0 + 1100 * MIN);
    assert.deepEqual(s.actual?.leidaComo.map((x) => `${x.chapa}×${x.lecturas}`), ["SDH1707×2", "SCH1707×1", "SDM1707×1"]);
    assert.deepEqual(s.variantes, [{ chapa: "SDH1707", lecturas: 2 }, { chapa: "SDM1707", lecturas: 1 }]);
});

test("se fue: la estadía cerrada, y después el paso por otra cámara", () => {
    const s = armarSeguimiento("SCH1707", [
        h("estadia", "1", "SCH1707", "cairoli", 0, 300), h("paso", "2", "SCH1707", "calle21", 304), h("paso", "3", "SCH1707", "calle21", 305),
        h("acceso", "4", "SCH1707", "salida", 309, 309, { sentido: "EXIT", decision: "DENY" }),
    ]);
    assert.equal(s.estado, "sin-lecturas");
    assert.deepEqual(s.tramos.map((t) => `${t.tipo}@${t.camara}×${t.lecturas}`), ["acceso@salida×1", "paso@calle21×2", "estadia@cairoli×1"]);
    assert.equal(s.actual?.sentido, "EXIT");
});

test("volvió horas después al mismo lugar: son dos estadías, no una", () => {
    const s = armarSeguimiento("SCH1707", [h("estadia", "1", "SCH1707", "cairoli", 0, 60), h("estadia", "2", "SCH1707", "cairoli", 300, 360, { abierta: true })]);
    assert.equal(s.tramos.length, 2);
    assert.equal(s.actual?.clave, "estadia:2");
    // …y la de ahora dice cuándo se la leyó por primera vez en esa cámara: con estadías por chapa, puede no haberse movido.
    assert.equal(s.actual?.primeraEnCamara, T0);
    assert.equal(s.tramos[1].primeraEnCamara, null);
});

test("otra chapa no entra; una con otro largo tampoco", () => {
    assert.equal(puedeSerLaMisma("SCH1707", "SDM1707"), true);
    assert.equal(puedeSerLaMisma("SCH1707", "AAU9032"), false);
    assert.equal(puedeSerLaMisma("SCH1707", "5DH177"), false);
    const s = armarSeguimiento("SCH1707", [h("paso", "1", "AAU9032", "calle21", 5)]);
    assert.equal(s.estado, "sin-datos");
});

test("cuánto duró, para leerlo de un vistazo", () => {
    assert.deepEqual([20_000, 3 * MIN, 60 * MIN, 1164 * MIN, 52 * 60 * MIN].map(cuantoDuro), ["menos de 1 min", "3 min", "1 h", "19 h 24 min", "2 d 4 h"]);
});

test("el aviso de partida dice de dónde, a qué hora, cuánto estuvo, y si la estadía estaba a nombre de otra lectura", () => {
    const desde = Date.UTC(2026, 10, 13, 1, 57), hasta = Date.UTC(2026, 10, 13, 21, 21); // 22:57 del 12 → 18:21 del 13, hora de Montevideo
    assert.equal(motivoDePartida("Ext. -> Cairoli", desde, hasta), "Se fue de Ext. -> Cairoli a las 18:21. Estuvo 19 h 24 min.");
    assert.equal(motivoDePartida(null, null, hasta, "SDH1707"), "Se fue a las 18:21. La estadía estaba a nombre de SDH1707 (misma cámara, lectura parecida).");
});

test("«se fue» sólo si lo midió el lugar; una estadía por chapa que se cierra es «dejó de leerse»", () => {
    assert.equal(armarSeguimiento("SCH1707", [h("estadia", "1", "SCH1707", "cairoli", 0, 60)]).estado, "sin-lecturas");
    assert.equal(armarSeguimiento("SCH1707", [h("estadia", "o-1", "SCH1707", "cairoli", 0, 60, { porLugar: true })]).estado, "se-fue");
});

test("las relecturas de la misma cámara durante una estadía son esa estadía, no hechos aparte", () => {
    const s = armarSeguimiento("SCH1707", [
        h("estadia", "1", "SCH1707", "cairoli", 0, 300, { abierta: true }), h("acceso", "2", "SDH1707", "cairoli", 50), h("acceso", "3", "SCH1707", "cairoli", 120), h("paso", "4", "SCH1707", "cairoli", 200),
        h("acceso", "5", "SCH1707", "entrada", 100),
    ]);
    assert.deepEqual(s.tramos.map((t) => `${t.tipo}@${t.camara}×${t.lecturas}`), ["estadia@cairoli×4", "acceso@entrada×1"]);
    assert.deepEqual(s.tramos[0].leidaComo, [{ chapa: "SCH1707", lecturas: 3 }, { chapa: "SDH1707", lecturas: 1 }]);
});
