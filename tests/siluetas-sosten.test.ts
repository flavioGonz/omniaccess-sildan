import { test } from "node:test";
import assert from "node:assert/strict";
import { sostenedor, CONFIANZA_ENTRA, CONFIANZA_SIGUE, GRACIA_MS } from "@/lib/siluetas-sosten";

const auto = (confianza: number, x = 0.2) => ({ grupo: "vehiculo", confianza, caja: [x, 0.2, x + 0.2, 0.5] });
const persona = (confianza: number, x = 0.7) => ({ grupo: "persona", confianza, caja: [x, 0.3, x + 0.05, 0.6] });

test("uno nuevo entra recién con la confianza de fábrica", () => {
    const s = sostenedor();
    assert.equal(s([auto(CONFIANZA_ENTRA - 0.05)], 0).length, 0);
    assert.equal(s([auto(CONFIANZA_ENTRA)], 100).length, 1);
});

test("el que ya estaba sigue aunque baje, mientras no pase el piso: no parpadea", () => {
    const s = sostenedor();
    s([auto(0.6)], 0);
    assert.equal(s([auto(0.31, 0.21)], 100).length, 1, "bajó de 0,40 pero es el mismo: sigue");
    assert.equal(s([auto(0.27, 0.22)], 200)[0].confianza, 0.27, "y se dibuja con lo de este cuadro");
    assert.ok(CONFIANZA_SIGUE < CONFIANZA_ENTRA);
});

test("uno con poca confianza en OTRO lugar no hereda nada", () => {
    const s = sostenedor();
    s([auto(0.8, 0.1)], 0);
    const r = s([auto(0.8, 0.1), auto(0.3, 0.7)], 100);
    assert.equal(r.length, 1);
});

test("una persona no sostiene a un auto: el grupo tiene que ser el mismo", () => {
    const s = sostenedor();
    s([{ grupo: "persona", confianza: 0.9, caja: [0.2, 0.2, 0.4, 0.5] }], 0);
    assert.deepEqual(s([auto(0.3)], 5000), []);
});

test("si falta en un cuadro se sostiene un instante con su última silueta, y después se va", () => {
    const s = sostenedor();
    const a = persona(0.7);
    s([a], 0);
    assert.deepEqual(s([], 120), [a]);
    assert.deepEqual(s([], 240), [a]);
    assert.deepEqual(s([], GRACIA_MS + 60), []);
    // Y si vuelve dentro de la gracia, sigue siendo él aunque vuelva con poca confianza.
    s([a], 1000); s([], 1100);
    assert.equal(s([persona(0.3, 0.705)], 1200).length, 1);
});

test("lo del detector entrenado pasa tal cual: su umbral es el de su clase", () => {
    const s = sostenedor<{ grupo: string; confianza: number; caja: number[] }>((o) => o.grupo !== "propio");
    const basurero = { grupo: "propio", confianza: 0.28, caja: [0, 0.6, 0.2, 1] };
    assert.deepEqual(s([basurero, auto(0.3)], 0), [basurero]);
    assert.deepEqual(s([], 100), [], "y no se sostiene cuando deja de venir");
});
