import test from "node:test";
import assert from "node:assert/strict";
import { diaYNoche, peoresHoras, sugerencias, estadoTasa, type Hora } from "@/lib/tasa-lectura";

const horas = (f: (h: number) => [number, number]): Hora[] => Array.from({ length: 24 }, (_, h) => { const [total, read] = f(h); return { hour: h, total, read, ratePct: total ? Math.round((read / total) * 1000) / 10 : null }; });

test("tasa: las horas peores necesitan intentos suficientes", () => {
    const hs = horas((h) => (h === 3 ? [2, 0] : h === 20 ? [40, 10] : h === 21 ? [30, 15] : [20, 19]));
    const p = peoresHoras(hs);
    assert.deepEqual(p.map((x) => x.hour), [20, 21], "la de las 3 tiene dos intentos: no se juzga");
});
test("tasa: día y noche por separado", () => {
    const hs = horas((h) => ([19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6].includes(h) ? [10, 3] : [10, 9]));
    const { dia, noche } = diaYNoche(hs);
    assert.equal(dia, 90); assert.equal(noche, 30);
});
test("tasa: una cámara que cae de noche lo dice con los números", () => {
    const hs = horas((h) => ([19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6].includes(h) ? [10, 3] : [10, 9]));
    const s = sugerencias({ metodo: "anpr", total: 240, read: 144, ratePct: 60, horas: hs });
    assert.equal(s[0].titulo, "Cae de noche"); assert.match(s[0].detalle, /30%.*90%/);
    assert.ok(!s.some((x) => x.titulo === "Lee poco todo el día"), "no se dice dos veces lo mismo");
});
test("tasa: OmniVision por escena y zona que descarta", () => {
    const hs = horas(() => [10, 1]);
    const s = sugerencias({ metodo: "omnivision", total: 240, read: 24, ratePct: 10, horas: hs, minutosEscenaPct: 80, fueraDeLinea: 30 });
    assert.equal(s[0].titulo, "Dispara por escena");
    assert.ok(s.some((x) => x.titulo === "La zona descarta lecturas buenas"));
    assert.ok(s.some((x) => x.titulo === "Lee poco todo el día"));
});
test("tasa: ANPR que OmniVision rescata, y pocos datos", () => {
    const s = sugerencias({ metodo: "anpr", total: 100, read: 60, ratePct: 60, horas: horas(() => [4, 2]), recuperadas: 25 });
    assert.ok(s.some((x) => x.titulo === "OmniVision lee lo que la cámara no"));
    assert.equal(sugerencias({ metodo: "anpr", total: 3, read: 1, ratePct: 33, horas: [] })[0].titulo, "Pocos datos");
    assert.equal(estadoTasa(95), "bien"); assert.equal(estadoTasa(80), "regular"); assert.equal(estadoTasa(10), "mal"); assert.equal(estadoTasa(null), "sin datos");
});
