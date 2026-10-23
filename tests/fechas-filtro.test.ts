/** El filtro de período con hora (lib/fechas: limiteDeFiltro, periodoConHora). Montevideo es UTC-3. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { limiteDeFiltro, periodoConHora } from "@/lib/fechas";

test("con hora: el minuto del barrio; «fin» incluye el minuto entero", () => {
    assert.equal(limiteDeFiltro("2026-10-23T03:00", "inicio")!.toISOString(), "2026-10-23T06:00:00.000Z");
    assert.equal(limiteDeFiltro("2026-10-23T04:00", "fin")!.toISOString(), "2026-10-23T07:00:59.999Z");
});

test("sin hora: el día entero, como antes", () => {
    assert.equal(limiteDeFiltro("2026-10-23", "inicio")!.toISOString(), "2026-10-23T03:00:00.000Z");
    assert.equal(limiteDeFiltro("2026-10-23", "fin")!.toISOString(), "2026-10-24T02:59:59.999Z");
    assert.equal(limiteDeFiltro("", "inicio"), null);
});

test("periodoConHora: «hasta» sin día usa el de «desde»; sin horas no cambia nada", () => {
    assert.deepEqual(periodoConHora("2026-10-23", "", "03:00", "04:00"), { desde: "2026-10-23T03:00", hasta: "2026-10-23T04:00" });
    assert.deepEqual(periodoConHora("2026-10-22", "2026-10-23", "22:00", "06:00"), { desde: "2026-10-22T22:00", hasta: "2026-10-23T06:00" });
    assert.deepEqual(periodoConHora("2026-10-20", "2026-10-21", "", ""), { desde: "2026-10-20", hasta: "2026-10-21" });
});
