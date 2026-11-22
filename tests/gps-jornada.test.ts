/** La jornada, la velocidad sobre la línea y los excesos de un recorrido (lib/gps-jornada). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { duracionLarga, excesosDe, franjaDe, jornadaDe, leerLimite, minutosEstacionado, puntoMasCercano, resumenDeExcesos, rumboEnPalabras, trozosPorVelocidad, type PuntoDeRuta } from "@/lib/gps-jornada";
import type { Viaje } from "@/lib/gps-viajes";

const h = (hhmmss: string) => `2026-11-23T${hhmmss}.000Z`;
const viaje = (desde: string, hasta: string, a: [number, number], b: [number, number]): Viaje =>
    ({ desde: h(desde), hasta: h(hasta), km: 10, minutos: 30, velMax: 80, velMedia: 40, inicio: { lat: a[0], lon: a[1] }, fin: { lat: b[0], lon: b[1] } });
const CASA: [number, number] = [-34.90, -56.10], OBRA: [number, number] = [-34.80, -56.00];
/** Puntos cada diez segundos, con las velocidades dadas, andando hacia el norte. */
const ruta = (vels: number[], cada = 10): PuntoDeRuta[] => vels.map((velocidad, i) => ({ lat: -34.9 + i * 0.002, lon: -56.1, cuando: new Date(Date.parse(h("12:00:00")) + i * cada * 1000).toISOString(), velocidad }));

test("la jornada alterna viajes y estacionado, con el de antes del primero y el de después del último", () => {
    const j = jornadaDe([viaje("08:10:00", "08:40:00", CASA, OBRA), viaje("17:40:00", "18:15:00", OBRA, CASA)], { desde: h("00:00:00"), hasta: h("21:00:00"), hastaAhora: true });
    assert.deepEqual(j.map((t) => t.tipo), ["estacionado", "viaje", "estacionado", "viaje", "estacionado"]);
    const [antes, v1, medio, , despues] = j;
    assert.ok(antes.tipo === "estacionado" && antes.minutos === 490 && antes.lat === CASA[0]);     // de 0:00 a 8:10, en casa
    assert.ok(v1.tipo === "viaje" && v1.n === 1);
    assert.ok(medio.tipo === "estacionado" && medio.minutos === 540 && medio.lat === OBRA[0] && !medio.sigue);  // nueve horas en la obra
    assert.ok(despues.tipo === "estacionado" && despues.minutos === 165 && despues.sigue);        // sigue ahí
    assert.equal(minutosEstacionado(j), 490 + 540 + 165);
});

test("un rato corto entre dos viajes no es estacionar, y sin viajes no hay jornada", () => {
    const j = jornadaDe([viaje("08:00:00", "08:30:00", CASA, OBRA), viaje("08:32:00", "09:00:00", OBRA, CASA)], { desde: h("08:00:00"), hasta: h("09:00:00") });
    assert.deepEqual(j.map((t) => t.tipo), ["viaje", "viaje"]);
    assert.deepEqual(jornadaDe([], { desde: h("00:00:00"), hasta: h("21:00:00") }), []);
});

test("la franja de una velocidad se mide contra el límite de la empresa", () => {
    assert.equal(franjaDe(20, 90), "lento");
    assert.equal(franjaDe(60, 90), "normal");
    assert.equal(franjaDe(85, 90), "borde");
    assert.equal(franjaDe(90, 90), "borde");        // justo el límite no es exceso
    assert.equal(franjaDe(91, 90), "exceso");
    assert.equal(franjaDe(50, 45), "exceso");       // con otro límite, otra vara
    assert.equal(leerLimite("110"), 110); assert.equal(leerLimite(""), 90); assert.equal(leerLimite(5), 90); assert.equal(leerLimite(900), 90);
});

test("la línea se corta por franja y los trozos se tocan", () => {
    const t = trozosPorVelocidad(ruta([60, 62, 95, 100, 61]), 90);
    assert.deepEqual(t.map((x) => x.franja), ["normal", "exceso", "normal"]);
    // Cada trozo arranca donde terminó el anterior: sin huecos.
    assert.deepEqual(t[1].linea[0], t[0].linea[t[0].linea.length - 1]);
    assert.deepEqual(t[2].linea[0], t[1].linea[t[1].linea.length - 1]);
    assert.equal(t.reduce((a, x) => a + x.linea.length - 1, 0), 4);     // cuatro tramos entre cinco puntos
});

test("los excesos: rachas seguidas sobre el límite, con cuánto duraron y a cuánto llegó", () => {
    const p = ruta([70, 80, 95, 112, 98, 85, 70, 93, 70]);
    const ex = excesosDe(p, 90);
    assert.equal(ex.length, 2);
    // El primero: tres reportes pasados; se cuenta desde el reporte anterior, que es donde aceleró.
    assert.deepEqual([ex[0].i0, ex[0].i1, ex[0].velMax, ex[0].segundos], [1, 4, 112, 30]);
    assert.ok(ex[0].metros > 600 && ex[0].metros < 700, String(ex[0].metros));
    // El segundo: un solo reporte pasado también cuenta.
    assert.deepEqual([ex[1].i0, ex[1].i1, ex[1].velMax], [6, 7, 93]);
    assert.deepEqual(resumenDeExcesos(ex), { veces: 2, segundos: 40, velMax: 112, metros: ex[0].metros + ex[1].metros });
    assert.deepEqual(excesosDe(p, 120), []);
});

test("dos reportes pasados con un hueco largo en el medio no son el mismo exceso", () => {
    const p = ruta([95, 96]); p[1].cuando = new Date(Date.parse(p[0].cuando) + 5 * 60_000).toISOString();
    assert.equal(excesosDe(p, 90).length, 2);
    // Y un exceso que llega hasta el final del recorrido se cierra igual.
    assert.equal(excesosDe(ruta([50, 95, 99]), 90).length, 1);
});

test("el punto más cercano a donde se tocó, el rumbo y las duraciones", () => {
    const p = ruta([10, 20, 30, 40]);
    assert.equal(puntoMasCercano(p, -34.8958, -56.1001), 2);
    assert.equal(puntoMasCercano([], 0, 0), -1);
    assert.equal(rumboEnPalabras(0), "norte"); assert.equal(rumboEnPalabras(44), "noreste"); assert.equal(rumboEnPalabras(350), "norte"); assert.equal(rumboEnPalabras(null), null);
    assert.equal(duracionLarga(45), "45 min"); assert.equal(duracionLarga(135), "2 h 15 min"); assert.equal(duracionLarga(540), "9 h"); assert.equal(duracionLarga(1440 * 3 + 240), "3 días 4 h");
});
