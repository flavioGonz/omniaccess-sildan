/** El parecido de forma entre dos huellas del lugar (lib/vigilia): la luz no cuenta, el dibujo sí. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parecidoDeForma, distancia } from "@/lib/vigilia";

const huella = (f: (i: number) => number) => Buffer.from(Array.from({ length: 576 }, (_, i) => Math.max(0, Math.min(255, Math.round(f(i))))));
const auto = huella((i) => (i % 24 > 6 && i % 24 < 18 && i > 150 && i < 450 ? 170 : 60) + (i % 5) * 4);

test("la misma escena con otra luz: la diferencia de gris salta, la forma no", () => {
    const deNoche = huella((i) => auto[i] * 0.45 + 8);     // más oscura y con menos contraste
    assert.ok(distancia(auto, deNoche) > 12, "con la regla de hoy esto es «el lugar cambió»");
    assert.ok(parecidoDeForma(auto, deNoche) > 0.98);
});

test("el auto ya no está: la forma cambia", () => {
    const vacio = huella((i) => 62 + (i % 7) * 3);
    assert.ok(parecidoDeForma(auto, vacio) < 0.4);
});

test("una huella lisa no tiene forma con qué comparar", () => {
    assert.equal(parecidoDeForma(huella(() => 12), auto), 0);
    assert.equal(parecidoDeForma(Buffer.alloc(0), auto), 0);
    assert.ok(Math.abs(parecidoDeForma(auto, auto) - 1) < 1e-9);
});
