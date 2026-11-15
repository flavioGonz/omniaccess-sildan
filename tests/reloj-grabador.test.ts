import { test } from "node:test";
import assert from "node:assert/strict";
import { correccionDeReloj } from "@/lib/reloj-grabador";

test("un grabador que atrasa se corrige hacia atrás, y uno que adelanta hacia adelante", () => {
    assert.equal(correccionDeReloj(-26), -26);
    assert.equal(correccionDeReloj(40), 40);
});
test("un par de segundos es ruido, y horas de diferencia es la zona horaria: no se corrige", () => {
    for (const d of [0, 2, -2, 10_800, -10_800, null, undefined, NaN]) assert.equal(correccionDeReloj(d), 0);
});
