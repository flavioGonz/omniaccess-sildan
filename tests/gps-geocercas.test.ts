/** La geometría y el horario de las geocercas (lib-gps-geocercas.js, por su envoltura con tipos). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { avisaCruce, bordeDe, circuloDe, dentroDe, enHorario, leerHorario, rotuloDeHorario } from "@/lib/gps-geocerca";

// Un predio en forma de L, de unos 200 m de lado, cerca de Montevideo.
const L: [number, number][] = [[-34.900, -56.100], [-34.900, -56.098], [-34.901, -56.098], [-34.901, -56.099], [-34.902, -56.099], [-34.902, -56.100]];
const predio = { lat: 0, lon: 0, radio: 0, puntos: L };
const UY = "America/Montevideo";
/** Una hora de Montevideo (UTC-3) como fecha. */
const a = (iso: string) => new Date(`${iso}-03:00`);

test("un polígono: adentro es adentro de su forma, no del círculo que lo contiene", () => {
    assert.equal(dentroDe(predio, -34.9005, -56.0990), true);    // el brazo de arriba
    assert.equal(dentroDe(predio, -34.9015, -56.0995), true);    // el brazo de abajo
    // El hueco de la L: adentro del círculo que contiene al predio, afuera del predio.
    assert.equal(dentroDe(predio, -34.9015, -56.0985), false);
    const c = circuloDe(L)!;
    assert.equal(dentroDe({ ...c }, -34.9015, -56.0985), true);
    assert.equal(dentroDe(predio, -34.905, -56.099), false);
});

test("un círculo sigue siendo un círculo, y lo mal formado no cuenta como polígono", () => {
    const base = { lat: -34.9, lon: -56.1, radio: 100 };
    assert.equal(dentroDe(base, -34.9005, -56.1), true);
    assert.equal(dentroDe(base, -34.902, -56.1), false);
    // Dos puntos no son una zona: se la trata por su círculo.
    assert.equal(dentroDe({ ...base, puntos: [[-34.9, -56.1], [-34.91, -56.11]] }, -34.9005, -56.1), true);
});

test("el borde: negativo adentro, positivo afuera, en metros", () => {
    // 0,0005° de latitud son unos 55 m: a esa distancia del lado norte, adentro.
    const dentro = bordeDe(predio, -34.9005, -56.0990);
    assert.ok(dentro < -40 && dentro > -70, String(dentro));
    // 0,001° al norte del lado norte: unos 111 m afuera.
    const fuera = bordeDe(predio, -34.899, -56.099);
    assert.ok(fuera > 100 && fuera < 120, String(fuera));
});

test("el círculo que contiene al polígono alcanza a todos sus vértices", () => {
    const c = circuloDe(L)!;
    for (const [lat, lon] of L) assert.equal(dentroDe(c, lat, lon), true);
    assert.equal(circuloDe([[1, 1]]), null);
});

test("sin horario vigila siempre; con horario, sólo en sus días y horas", () => {
    assert.equal(enHorario(null, a("2026-11-23T03:00:00"), UY), true);
    const oficina = { dias: [1, 2, 3, 4, 5], desde: "08:00", hasta: "18:00" };
    assert.equal(enHorario(oficina, a("2026-11-23T08:00:00"), UY), true);     // lunes, justo al abrir
    assert.equal(enHorario(oficina, a("2026-11-23T17:59:00"), UY), true);
    assert.equal(enHorario(oficina, a("2026-11-23T18:00:00"), UY), false);    // el cierre ya no cuenta
    assert.equal(enHorario(oficina, a("2026-11-22T10:00:00"), UY), false);    // domingo
});

test("un horario que cruza la medianoche pertenece al día en que empieza", () => {
    const noche = { dias: [1, 2, 3, 4, 5], desde: "22:00", hasta: "06:00" };
    assert.equal(enHorario(noche, a("2026-11-27T23:00:00"), UY), true);       // viernes de noche
    assert.equal(enHorario(noche, a("2026-11-28T02:00:00"), UY), true);       // madrugada del sábado: la guardia del viernes
    assert.equal(enHorario(noche, a("2026-11-28T23:00:00"), UY), false);      // sábado de noche: no es día
    assert.equal(enHorario(noche, a("2026-11-23T02:00:00"), UY), false);      // madrugada del lunes: sería la del domingo
    assert.equal(enHorario(noche, a("2026-11-23T12:00:00"), UY), false);      // lunes al mediodía
});

test("la hora es la del sitio, no la del servidor", () => {
    // 01:00 UTC del martes son las 22:00 del lunes en Montevideo.
    assert.equal(enHorario({ dias: [1], desde: "21:00", hasta: "23:00" }, new Date("2026-11-24T01:00:00Z"), UY), true);
});

test("un horario roto no deja la geocerca muda: vale como «siempre»", () => {
    assert.equal(leerHorario({ dias: [], desde: "08:00", hasta: "18:00" }), null);
    assert.equal(leerHorario({ dias: [1], desde: "8", hasta: "18:00" }), null);
    assert.equal(leerHorario({ dias: [1], desde: "08:00", hasta: "08:00" }), null);
    assert.equal(enHorario({ dias: [9], desde: "xx", hasta: "yy" }, a("2026-11-23T03:00:00"), UY), true);
    assert.deepEqual(leerHorario({ dias: [5, 1, 1, "3"], desde: "22:00", hasta: "06:00" }), { dias: [1, 3, 5], desde: "22:00", hasta: "06:00" });
});

test("qué cruce avisa, y cómo se dice el horario", () => {
    assert.equal(avisaCruce({}, true), true);
    assert.equal(avisaCruce({ avisa: "sale" }, true), false);
    assert.equal(avisaCruce({ avisa: "sale" }, false), true);
    assert.equal(rotuloDeHorario(null), "siempre");
    assert.equal(rotuloDeHorario({ dias: [1, 2, 3, 4, 5], desde: "22:00", hasta: "06:00" }), "lun a vie, de 22:00 a 06:00");
    assert.equal(rotuloDeHorario({ dias: [0, 6], desde: "00:00", hasta: "23:59" }), "sáb, dom, de 00:00 a 23:59");
    assert.equal(rotuloDeHorario({ dias: [0, 1, 2, 3, 4, 5, 6], desde: "20:00", hasta: "07:00" }), "todos los días, de 20:00 a 07:00");
});
