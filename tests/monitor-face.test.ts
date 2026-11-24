/** Monitor Face (lib/monitor-face.ts): las ráfagas de una misma persona y cómo se explica cada decisión. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparRafagas, explicarIdentidad, rotuloIdentidad, tramosDeTamano, identidadDe, type PasoAgrupable, type IdentidadPaso } from "@/lib/monitor-face";

const T0 = Date.parse("2026-11-24T12:00:00Z");
/** Una captura `s` segundos antes de T0 (vienen de la más nueva a la más vieja, como de la base). */
const paso = (id: string, s: number, o: Partial<PasoAgrupable> = {}): PasoAgrupable => ({
    id, cuando: new Date(T0 - s * 1000).toISOString(), deviceId: "portero", fuente: "omnivision", identidad: "sin-cara", rostroId: null, caraPx: 30, ...o,
});
const ids = (r: { cabeza: PasoAgrupable; resto: PasoAgrupable[] }[]) => r.map((x) => [x.cabeza.id, ...x.resto.map((y) => y.id)].join(","));

test("capturas seguidas del mismo equipo son una ráfaga, con la cara identificada al frente", () => {
    const r = agruparRafagas([paso("a", 0), paso("b", 8, { identidad: "misma", rostroId: "r1", caraPx: 110 }), paso("c", 15)]);
    assert.deepEqual(ids(r), ["b,a,c"]);
});

test("se corta cuando pasa más de la ventana desde la anterior de la ráfaga (no desde la primera)", () => {
    const r = agruparRafagas([paso("a", 0), paso("b", 15), paso("c", 30), paso("d", 60)]);
    assert.deepEqual(ids(r), ["a,b,c", "d"]);
});

test("dos identidades distintas no se juntan: son dos personas aunque pasen juntas", () => {
    const r = agruparRafagas([paso("a", 0, { identidad: "misma", rostroId: "r1" }), paso("b", 5, { identidad: "nueva", rostroId: "r2" })]);
    assert.deepEqual(ids(r), ["a", "b"]);
});

test("lo que contó el equipo nunca se agrupa: cada una es una decisión de la puerta", () => {
    const r = agruparRafagas([paso("a", 0, { fuente: "equipo", identidad: "equipo" }), paso("b", 3, { fuente: "equipo", identidad: "equipo" }), paso("c", 6)]);
    assert.deepEqual(ids(r), ["a", "b", "c"]);
});

test("otro equipo es otra ráfaga, aunque sea en el mismo segundo", () => {
    const r = agruparRafagas([paso("a", 0), paso("b", 1, { deviceId: "control" }), paso("c", 2)]);
    assert.deepEqual(ids(r), ["a,c", "b"]);
});

test("entre dos sin comparar va al frente la cara más grande", () => {
    const r = agruparRafagas([paso("a", 0, { caraPx: 22 }), paso("b", 4, { caraPx: 64 }), paso("c", 9, { caraPx: 40 })]);
    assert.equal(r[0].cabeza.id, "b");
    assert.deepEqual(r[0].resto.map((x) => x.id), ["a", "c"]);
});

const U = { misma: 0.8, parecida: 0.74, padron: 0.89, pxMin: 80 };
const p = (identidad: IdentidadPaso, o: Partial<{ similitud: number; persona: string; caraPx: number; sinIdentidad: string }> = {}) =>
    ({ identidad, similitud: null, persona: null, caraPx: null, sinIdentidad: null, ...o });

test("cada decisión se explica con sus números y el umbral que la decidió", () => {
    assert.match(explicarIdentidad(p("misma", { similitud: 84, persona: "R-0012" }), U), /84 % a R-0012; desde el 80 %/);
    assert.match(explicarIdentidad(p("nueva", { similitud: 77, persona: "R-0013" }), U), /entre 74 % y 80 % no se decide solo/);
    assert.match(explicarIdentidad(p("nueva", { similitud: 41, persona: "R-0014" }), U), /lo más parecido, 41 %/);
    assert.match(explicarIdentidad(p("sin-cara", { caraPx: 42, sinIdentidad: "cara chica (42 px)" }), U), /mide 42 px y el motor pide 80/);
    assert.match(explicarIdentidad(p("sin-cara", { sinIdentidad: "el motor no la tomó como cara" }), U), /^El motor no la tomó como cara/);
    assert.match(explicarIdentidad(p("padron", { similitud: 93, persona: "Una Persona" }), U), /pide 89 %/);
});

test("rótulos cortos para la baldosa", () => {
    const base = { veces: null, sinIdentidad: null, tipo: "FACE", decision: "GRANT" };
    assert.equal(rotuloIdentidad({ ...base, identidad: "misma", veces: 5 }), "Vista 5 veces");
    assert.equal(rotuloIdentidad({ ...base, identidad: "misma", veces: 1 }), "Ya vista");
    assert.equal(rotuloIdentidad({ ...base, identidad: "sin-cara", sinIdentidad: "cara chica (30 px)" }), "Cara chica");
    assert.equal(rotuloIdentidad({ ...base, identidad: "equipo", decision: "DENY" }), "Negado por el equipo");
    assert.equal(rotuloIdentidad({ ...base, identidad: "equipo", tipo: "TAG" }), "Lo contó el equipo");
});

test("los tramos de tamaño se arman alrededor del mínimo del motor", () => {
    assert.deepEqual(tramosDeTamano(80).map((t) => t.rotulo), ["menos de 40 px", "40 a 79 px", "80 a 159 px", "160 px o más"]);
});

test("la identidad de una fila: lo del equipo es del equipo, y lo nuestro sin dato no cuenta como comparado", () => {
    assert.equal(identidadDe(false, "misma"), "equipo");
    assert.equal(identidadDe(true, null), "sin-cara");
    assert.equal(identidadDe(true, "padron"), "padron");
});
