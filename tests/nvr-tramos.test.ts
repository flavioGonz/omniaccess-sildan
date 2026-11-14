/** Los tramos grabados de un NVR (lib/nvr-tramos): leer cada página sin creerle a `numOfMatches`. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { leerPaginaDeTramos, unirTramos, msDeLocal } from "@/lib/nvr-tramos";

const item = (a: string, b: string) => `<searchMatchItem><sourceID>x</sourceID><trackID>101</trackID><timeSpan><startTime>${a}</startTime><endTime>${b}</endTime></timeSpan></searchMatchItem>`;
const pagina = (items: string[], total: number, estado: string | null) =>
    `<CMSearchResult><searchID>1</searchID><responseStatus>true</responseStatus>${estado ? `<responseStatusStrg>${estado}</responseStatusStrg>` : ""}<numOfMatches>${total}</numOfMatches><matchList>${items.join("")}</matchList></CMSearchResult>`;
const cien = Array.from({ length: 100 }, (_, i) => item(`2026-11-14T${String(Math.floor(i / 30)).padStart(2, "0")}:${String((i % 30) * 2).padStart(2, "0")}:00Z`, `2026-11-14T${String(Math.floor(i / 30)).padStart(2, "0")}:${String((i % 30) * 2).padStart(2, "0")}:40Z`));

test("el NVR de IES: `numOfMatches` es el total del día, no lo que trae la página", () => {
    // Medido el 14/11: 251 en las tres páginas, 100 tramos en cada una de las dos primeras, MORE, MORE, OK.
    const p = leerPaginaDeTramos(pagina(cien, 251, "MORE"));
    assert.equal(p.cuantos, 100);   // con esto se avanza: la próxima página se pide desde la 100, no desde la 251
    assert.equal(p.tramos.length, 100);
    assert.equal(p.hayMas, true);
    const ultima = leerPaginaDeTramos(pagina(cien.slice(0, 51), 251, "OK"));
    assert.equal(ultima.cuantos, 51);
    assert.equal(ultima.hayMas, false);
});

test("un NVR que no dice si hay más: con la página llena se sigue, con menos se termina", () => {
    assert.equal(leerPaginaDeTramos(pagina(cien, 100, null)).hayMas, true);
    assert.equal(leerPaginaDeTramos(pagina(cien.slice(0, 24), 24, null)).hayMas, false);
    assert.equal(leerPaginaDeTramos(pagina([], 0, "NO MATCHES")).hayMas, false);
    assert.equal(leerPaginaDeTramos(pagina([], 0, "NO MATCHES")).cuantos, 0);
});

test("un tramo ilegible cuenta para avanzar, pero no entra en la lista", () => {
    const p = leerPaginaDeTramos(pagina([item("2026-11-14T10:00:00Z", "2026-11-14T10:05:00Z"), item("2026-11-14T10:10:00Z", "2026-11-14T10:10:00Z")], 2, "OK"));
    assert.equal(p.cuantos, 2);
    assert.equal(p.tramos.length, 1);
    assert.equal(p.tramos[0][0], msDeLocal("2026-11-14T10:00:00"));
});

test("unirTramos pega los seguidos y deja los huecos de verdad", () => {
    const m = (h: number, min: number) => Date.UTC(2026, 10, 14, h, min);
    assert.deepEqual(unirTramos([[m(3, 0), m(4, 0)], [m(1, 0), m(2, 0)], [m(2, 0) + 1500, m(2, 30)], [m(2, 20), m(2, 25)]]), [[m(1, 0), m(2, 30)], [m(3, 0), m(4, 0)]]);
    assert.deepEqual(unirTramos([]), []);
});
