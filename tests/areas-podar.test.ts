import test from "node:test";
import assert from "node:assert/strict";
import { podarEquipos } from "@/lib/areas-podar";

test("áreas: se van las asignaciones de equipos borrados", () => {
    const r = podarEquipos({ a: "ar1", borrado: "ar1", b: "ar2" }, ["a", "b"], ["ar1", "ar2"]);
    assert.deepEqual(r.equipos, { a: "ar1", b: "ar2" });
    assert.equal(r.quitados, 1);
});
test("áreas: un equipo en un área que ya no existe queda sin área", () => {
    const r = podarEquipos({ a: "vieja", b: "ar1" }, ["a", "b"], ["ar1"]);
    assert.deepEqual(r.equipos, { b: "ar1" });
    assert.equal(r.quitados, 1);
});
test("áreas: sin nada que podar, igual", () => {
    const e = { a: "ar1" };
    assert.deepEqual(podarEquipos(e, ["a"], ["ar1"]), { equipos: e, quitados: 0 });
});
