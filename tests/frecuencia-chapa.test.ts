import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarioDePasos } from "@/components/visor/FrecuenciaDeChapa";

test("el calendario: un casillero por día, con los pasos de ese día en la hora del barrio", () => {
    const ahora = Date.UTC(2026, 10, 16, 21, 0, 0); // 18:00 en Montevideo
    const c = calendarioDePasos([
        { momento: "2026-11-16T12:00:00.000Z" }, { momento: "2026-11-16T20:00:00.000Z" },
        // 01:30 UTC del 15 son las 22:30 del 14 en el barrio: cuenta para el 14.
        { momento: "2026-11-15T01:30:00.000Z" },
        { momento: "2026-10-01T12:00:00.000Z" },
    ], 7, ahora);
    assert.equal(c.length, 7);
    assert.deepEqual([c[0].date, c[6].date], ["2026-11-10", "2026-11-16"]);
    assert.deepEqual(c.map((x) => x.count), [0, 0, 0, 0, 1, 0, 2]);
    assert.deepEqual([c[4].level, c[5].level, c[6].level], [2, 0, 4]);
});
