/** El contexto de una lectura de la Lista Amarilla (lib-contexto-vigilancia). Montevideo es UTC-3. */
import { test } from "node:test";
import assert from "node:assert/strict";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextoDe, fraseDeContexto, cuandoFue } = require("../lib-contexto-vigilancia.js");

const Z = "America/Montevideo";
/** Un instante dado en hora de Montevideo. */
const mvd = (iso: string) => new Date(`${iso}:00-03:00`);
const ahora = mvd("2026-11-12T10:30"); // jueves

test("primera vez: sin lecturas anteriores", () => {
    const c = contextoDe([], ahora, Z);
    assert.deepEqual(c, { lecturas7: 1, dias7: 1, anterior: null });
    assert.equal(fraseDeContexto(c, ahora, Z), "Primera vez que se la ve");
});

test("lista ausente o con basura no rompe", () => {
    assert.equal(contextoDe(undefined, ahora, Z).lecturas7, 1);
    assert.equal(contextoDe([null, { ts: "no es fecha" }], ahora, Z).anterior, null);
    assert.equal(fraseDeContexto(null, ahora, Z), "");
});

test("5.ª lectura en 4 días distintos, la anterior ayer 22:14", () => {
    const antes = [
        { ts: mvd("2026-11-11T22:14"), camara: "Portón Sur" },
        { ts: mvd("2026-11-11T08:02"), camara: "Portón Norte" },
        { ts: mvd("2026-11-09T19:40"), camara: "Portón Sur" },
        { ts: mvd("2026-11-07T07:55"), camara: "Portón Sur" },
    ];
    const c = contextoDe(antes, ahora, Z);
    assert.equal(c.lecturas7, 5);
    assert.equal(c.dias7, 4); // 7, 9, 11 y hoy
    assert.equal(fraseDeContexto(c, ahora, Z), "5.ª lectura en 7 días, en 4 días distintos · anterior: ayer 22:14 en Portón Sur");
});

test("el orden de la lista no importa: la anterior es la más reciente", () => {
    const c = contextoDe([{ ts: mvd("2026-11-09T19:40"), camara: "A" }, { ts: mvd("2026-11-12T09:00"), camara: "B" }], ahora, Z);
    assert.equal(c.anterior.camara, "B");
    assert.equal(fraseDeContexto(c, ahora, Z), "3.ª lectura en 7 días, en 2 días distintos · anterior: hoy 09:00 en B");
});

test("única anterior de hace más de 7 días: lleva la fecha y no cuenta en la semana", () => {
    const c = contextoDe([{ ts: mvd("2026-10-20T18:05"), camara: "Portón Sur" }], ahora, Z);
    assert.equal(c.lecturas7, 1);
    assert.equal(c.dias7, 1);
    assert.equal(fraseDeContexto(c, ahora, Z), "Primera lectura en 7 días · anterior: el 20/10 18:05 en Portón Sur");
});

test("23:50 y 00:10 son dos días para el barrio, aunque en UTC sean el mismo", () => {
    const madrugada = mvd("2026-11-12T00:10");
    const c = contextoDe([{ ts: mvd("2026-11-11T23:50"), camara: null }], madrugada, Z);
    assert.equal(c.dias7, 2);
    assert.equal(fraseDeContexto(c, madrugada, Z), "2.ª lectura en 7 días, en 2 días distintos · anterior: ayer 23:50");
});

test("dos lecturas el mismo día cuentan un día", () => {
    const c = contextoDe([{ ts: mvd("2026-11-12T08:00"), camara: "A" }], ahora, Z);
    assert.equal(fraseDeContexto(c, ahora, Z), "2.ª lectura en 7 días, en 1 día distinto · anterior: hoy 08:00 en A");
});

test("cuándo fue: dentro de la semana dice el día; de otro año, el año", () => {
    assert.equal(cuandoFue(mvd("2026-11-09T19:40"), ahora, Z), "el lun 19:40");
    assert.equal(cuandoFue(mvd("2025-12-30T07:00"), ahora, Z), "el 30/12/2025 07:00");
});

test("una lectura con hora posterior al reloj se ignora (relojes de cámara adelantados)", () => {
    const c = contextoDe([{ ts: mvd("2026-11-12T11:00"), camara: "A" }], ahora, Z);
    assert.equal(c.anterior, null);
});
