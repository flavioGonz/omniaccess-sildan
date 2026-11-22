/** Los filtros del cajón de un rastreador (lib/gps-filtro). La zona de las pruebas es Montevideo (UTC-3). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FILTRO_INICIAL, filtrosPuestos, paraInputConHora, rangoDeFiltro, sirveParaRecorrido, tiposQueDicen } from "@/lib/gps-filtro";

// Lunes 23/11/2026 a las 10:30 de Montevideo.
const AHORA = new Date("2026-11-23T13:30:00Z");
const iso = (d: Date | null) => d?.toISOString() ?? null;

test("las ventanas hacia atrás llegan hasta ahora", () => {
    const r = rangoDeFiltro({ periodo: "24h", desde: "", hasta: "" }, AHORA);
    assert.equal(iso(r.desde), "2026-11-22T13:30:00.000Z"); assert.equal(r.hasta, null);
    assert.equal(iso(rangoDeFiltro({ periodo: "7d", desde: "", hasta: "" }, AHORA).desde), "2026-11-16T13:30:00.000Z");
    assert.deepEqual(rangoDeFiltro({ periodo: "todo", desde: "", hasta: "" }, AHORA), { desde: null, hasta: null });
});

test("hoy y ayer son días del sitio, no del servidor", () => {
    // Hoy empieza a la medianoche de Montevideo: las 03:00 UTC.
    const hoy = rangoDeFiltro({ periodo: "hoy", desde: "", hasta: "" }, AHORA);
    assert.equal(iso(hoy.desde), "2026-11-23T03:00:00.000Z"); assert.equal(hoy.hasta, null);
    const ayer = rangoDeFiltro({ periodo: "ayer", desde: "", hasta: "" }, AHORA);
    assert.equal(iso(ayer.desde), "2026-11-22T03:00:00.000Z"); assert.equal(iso(ayer.hasta), "2026-11-23T02:59:59.999Z");
    // A las 23:30 de Montevideo ya es el día siguiente en UTC: «hoy» sigue siendo el 23.
    assert.equal(iso(rangoDeFiltro({ periodo: "hoy", desde: "", hasta: "" }, new Date("2026-11-24T02:30:00Z")).desde), "2026-11-23T03:00:00.000Z");
});

test("un rango con fecha y hora: «el jueves entre las dos y las cuatro de la mañana»", () => {
    const r = rangoDeFiltro({ periodo: "rango", desde: "2026-11-19T02:00", hasta: "2026-11-19T04:00" }, AHORA);
    assert.equal(iso(r.desde), "2026-11-19T05:00:00.000Z");
    assert.equal(iso(r.hasta), "2026-11-19T07:00:59.999Z");     // «hasta las 04:00» incluye ese minuto
    assert.equal(r.error, undefined);
});

test("un rango a medio escribir vale; uno al revés se dice", () => {
    const soloDesde = rangoDeFiltro({ periodo: "rango", desde: "2026-11-19T02:00", hasta: "" }, AHORA);
    assert.ok(soloDesde.desde && soloDesde.hasta === null && !soloDesde.error);
    assert.deepEqual(rangoDeFiltro({ periodo: "rango", desde: "", hasta: "" }, AHORA), { desde: null, hasta: null });
    assert.match(rangoDeFiltro({ periodo: "rango", desde: "2026-11-20T10:00", hasta: "2026-11-19T10:00" }, AHORA).error || "", /posterior/);
});

test("la fecha para el campo sale en la hora del sitio", () => {
    assert.equal(paraInputConHora(AHORA), "2026-11-23T10:30");
    assert.equal(paraInputConHora(new Date("2026-11-24T02:05:00Z")), "2026-11-23T23:05");
    // Ida y vuelta: lo que el campo muestra, leído de nuevo, es el mismo minuto.
    assert.equal(iso(rangoDeFiltro({ periodo: "rango", desde: paraInputConHora(AHORA), hasta: "" }, AHORA).desde), "2026-11-23T13:30:00.000Z");
});

test("el recorrido se puede pedir si el período tiene comienzo y no pasa de un mes", () => {
    assert.equal(sirveParaRecorrido(rangoDeFiltro({ periodo: "7d", desde: "", hasta: "" }, AHORA), AHORA), true);
    assert.equal(sirveParaRecorrido(rangoDeFiltro({ periodo: "30d", desde: "", hasta: "" }, AHORA), AHORA), true);
    assert.equal(sirveParaRecorrido(rangoDeFiltro({ periodo: "todo", desde: "", hasta: "" }, AHORA), AHORA), false);
    assert.equal(sirveParaRecorrido(rangoDeFiltro({ periodo: "rango", desde: "2026-08-01T00:00", hasta: "2026-11-01T00:00" }, AHORA), AHORA), false);
    assert.equal(sirveParaRecorrido(rangoDeFiltro({ periodo: "rango", desde: "2026-11-20T10:00", hasta: "2026-11-19T10:00" }, AHORA), AHORA), false);
});

test("buscar por lo que dice el evento, con o sin tildes; y cuántos filtros hay puestos", () => {
    assert.ok(tiposQueDicen("alimentacion").includes("GPS_CORTE"));
    assert.ok(tiposQueDicen("geocerca").includes("GPS_GEOCERCA_ENTRA") && tiposQueDicen("geocerca").includes("GPS_GEOCERCA_SALE"));
    assert.deepEqual(tiposQueDicen("a"), []);       // una letra no busca
    assert.equal(filtrosPuestos(FILTRO_INICIAL), 0);
    assert.equal(filtrosPuestos({ ...FILTRO_INICIAL, clase: "alarma", tipos: ["GPS_SOS"], texto: " base ", soloCasos: true }), 4);
});
