/** Carriles, zonas de captura y líneas de cruce de la lectura de OmniVision (lib-geometria-lpr, 26/11). */
import test from "node:test";
import assert from "node:assert/strict";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const g = require("../lib-geometria-lpr.js");

// Una cámara que mira la entrada (mano izquierda, los autos suben en la imagen) y la salida
// (mano derecha, bajan). Coordenadas 0..1, y hacia abajo.
const GEO = g.leerGeometria({
    activa: true, rebote: 30,
    carriles: [
        { id: "ent", nombre: "Entrada", puntos: [{ x: 0, y: 0.3 }, { x: 0.5, y: 0.3 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }], sentido: "entra", flecha: { a: { x: 0.25, y: 0.9 }, b: { x: 0.25, y: 0.4 } } },
        { id: "sal", nombre: "Salida", puntos: [{ x: 0.5, y: 0.3 }, { x: 1, y: 0.3 }, { x: 1, y: 1 }, { x: 0.5, y: 1 }], sentido: "sale", flecha: { a: { x: 0.75, y: 0.4 }, b: { x: 0.75, y: 0.9 } } },
    ],
});
const chapa = (x: number, y: number) => ({ x: x - 0.03, y: y - 0.01, w: 0.06, h: 0.02, ar: 16 / 9 });
const lect = (x: number, y: number, cuadro: number) => ({ recuadro: chapa(x, y), cuadro });

test("geometría: sin nada dibujado o apagada no aplica (manda la compuerta de siempre)", () => {
    assert.equal(g.leerGeometria(null), null);
    assert.equal(g.leerGeometria({ activa: true, carriles: [], zonas: [], lineas: [] }), null);
    assert.equal(g.leerGeometria({ activa: false, zonas: [{ puntos: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }] }), null);
    assert.equal(g.leerGeometria("{roto"), null);
});
test("geometría: el carril dice el sentido del evento", () => {
    const sube = g.movimiento([lect(0.25, 0.8, 1), lect(0.25, 0.6, 4)]);
    const r = g.evaluarGeometria(GEO, chapa(0.25, 0.6), sube);
    assert.equal(r.pasa, true); assert.equal(r.elemento, "ent"); assert.equal(g.tipoPorSentido(r.sentido), "ENTRY");
    const baja = g.movimiento([lect(0.75, 0.5, 1), lect(0.75, 0.7, 3)]);
    assert.equal(g.tipoPorSentido(g.evaluarGeometria(GEO, chapa(0.75, 0.7), baja).sentido), "EXIT");
});
test("geometría: un auto de contramano en el carril no se lee como del carril", () => {
    const bajaPorLaEntrada = g.movimiento([lect(0.25, 0.5, 1), lect(0.25, 0.75, 4)]);
    const r = g.evaluarGeometria(GEO, chapa(0.25, 0.75), bajaPorLaEntrada);
    assert.equal(r.pasa, false); assert.equal(r.motivo, "contramano");
});
test("geometría: sin movimiento no se descarta por sentido (mejor una de más)", () => {
    const r = g.evaluarGeometria(GEO, chapa(0.25, 0.6), g.movimiento([lect(0.25, 0.6, 1)]));
    assert.equal(r.pasa, true); assert.equal(r.elemento, "ent");
});
test("geometría: fuera de todo lo dibujado no pasa", () => {
    assert.equal(g.evaluarGeometria(GEO, chapa(0.5, 0.1), null).pasa, false);
});
test("geometría: la línea de cruce con sentido A→B", () => {
    // Línea horizontal de izquierda (A) a derecha (B): «ab» es cruzar hacia abajo en la imagen.
    const L = g.leerGeometria({ lineas: [{ id: "l1", a: { x: 0.1, y: 0.5 }, b: { x: 0.9, y: 0.5 }, sentido: "ab" }] });
    const baja = g.movimiento([lect(0.5, 0.45, 1), lect(0.5, 0.55, 3)]);
    const sube = g.movimiento([lect(0.5, 0.55, 1), lect(0.5, 0.45, 3)]);
    assert.equal(g.evaluarGeometria(L, chapa(0.5, 0.5), baja).pasa, true);
    assert.equal(g.evaluarGeometria(L, chapa(0.5, 0.5), sube).pasa, false);
    assert.equal(g.evaluarGeometria(L, chapa(0.5, 0.9), baja).pasa, false, "lejos de la línea");
});
test("geometría: el rebote descarta la misma chapa en el mismo carril", () => {
    const m = new Map();
    assert.equal(g.esRebote(m, GEO, "AAA1234", "ent", 1_000), false);
    assert.equal(g.esRebote(m, GEO, "AAA1234", "ent", 20_000), true, "19 s después: rebote");
    assert.equal(g.esRebote(m, GEO, "AAA1234", "sal", 20_000), false, "otro carril: no");
    assert.equal(g.esRebote(m, GEO, "AAA1234", "ent", 40_000), false, "pasados los 30 s vuelve a contar");
});
test("geometría: con recorte, el recuadro se lleva al cuadro entero", () => {
    const r = g.aCuadroEntero({ x: 0.5, y: 0.5, w: 0.1, h: 0.1, ar: 1 }, { x: 0.2, y: 0.4, w: 0.5, h: 0.5 });
    assert.deepEqual([r.x, r.y, r.w, r.h], [0.45, 0.65, 0.05, 0.05]);
    assert.equal(g.aCuadroEntero({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, null).x, 0.5);
});
