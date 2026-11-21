import test from "node:test";
import assert from "node:assert/strict";
import { resumenDeViajes, viajesYParadas } from "@/lib/gps-viajes";
import { esConfiable } from "@/lib/gps-recorrido";
import type { PuntoRecorrido } from "@/lib/gps-recorrido";

const T0 = Date.parse("2026-11-20T12:00:00Z");
/** Un tramo: `n` reportes cada 10 s, avanzando ~100 m por reporte si `vel` > 0. */
function tramo(desdeSeg: number, n: number, vel: number, latBase: number): PuntoRecorrido[] {
    return Array.from({ length: n }, (_, i) => ({
        lat: latBase + (vel > 0 ? i * 0.0009 : 0), lon: -56.15,
        cuando: new Date(T0 + (desdeSeg + i * 10) * 1000).toISOString(), velocidad: vel,
    }));
}

test("un viaje, una parada larga y otro viaje", () => {
    const ida = tramo(0, 30, 36, -34.90);                                   // 5 min andando, ~2,9 km
    const quieto = tramo(300, 60, 0, -34.90 + 29 * 0.0009);                 // 10 min quieto
    const vuelta = tramo(900, 30, 36, -34.90 + 29 * 0.0009);                // otros 5 min
    const r = viajesYParadas([...ida, ...quieto, ...vuelta]);
    assert.equal(r.viajes.length, 2);
    assert.ok(r.viajes[0].km > 2.7 && r.viajes[0].km < 3.1, String(r.viajes[0].km));
    assert.equal(r.viajes[0].velMax, 36);
    assert.equal(r.paradas.length, 1);
    assert.ok(r.paradas[0].minutos >= 9 && r.paradas[0].minutos <= 11, String(r.paradas[0].minutos));
});

test("un semáforo de un minuto no parte el viaje", () => {
    const a = tramo(0, 20, 40, -34.90);
    const semaforo = tramo(200, 6, 0, -34.90 + 19 * 0.0009);                // 1 min quieto
    const b = tramo(260, 20, 40, -34.90 + 19 * 0.0009);
    const r = viajesYParadas([...a, ...semaforo, ...b]);
    assert.equal(r.viajes.length, 1);
    assert.equal(r.paradas.length, 0);
});

test("un auto estacionado, con el ruido del GPS, no hizo ningún viaje", () => {
    const quieto: PuntoRecorrido[] = Array.from({ length: 300 }, (_, i) => ({
        lat: -34.889414 + (i % 3) * 0.0001, lon: -56.144064 + (i % 2) * 0.0001,
        cuando: new Date(T0 + i * 10_000).toISOString(), velocidad: 0,
    }));
    const r = viajesYParadas(quieto);
    assert.equal(r.viajes.length, 0); assert.equal(r.paradas.length, 0);
});

test("media hora sin reportes en el medio son dos viajes, no uno", () => {
    const a = tramo(0, 20, 50, -34.90);
    const b = tramo(200 + 30 * 60, 20, 50, -34.80);                         // reaparece media hora después, en otro lado
    const r = viajesYParadas([...a, ...b]);
    assert.equal(r.viajes.length, 2);
    // Y el salto del hueco no se le suma a ninguno de los dos.
    assert.ok(r.viajes[0].km < 2.5 && r.viajes[1].km < 2.5, `${r.viajes[0].km} / ${r.viajes[1].km}`);
});

test("mover el auto unos metros no es un viaje", () => {
    const maniobra: PuntoRecorrido[] = [
        { lat: -34.9, lon: -56.15, cuando: new Date(T0).toISOString(), velocidad: 0 },
        { lat: -34.9001, lon: -56.15, cuando: new Date(T0 + 10_000).toISOString(), velocidad: 6 },
        { lat: -34.9002, lon: -56.15, cuando: new Date(T0 + 20_000).toISOString(), velocidad: 5 },
        { lat: -34.9002, lon: -56.15, cuando: new Date(T0 + 30_000).toISOString(), velocidad: 0 },
    ];
    assert.equal(viajesYParadas(maniobra).viajes.length, 0);
});

test("la deriva de una noche con mala señal no es un viaje (lo medido el 21/11)", () => {
    /* Lo que queda del equipo estacionado DESPUÉS de sacar las posiciones con pocos satélites:
       saltos de decenas de metros alrededor del mismo lugar, CON velocidad (4 a 20 km/h),
       durante horas. Recorre kilómetros de a pasitos y no se aleja nunca más de una cuadra.
       (Los saltos de 300–400 m venían todos con 7 satélites o menos: esos los frena la otra
       compuerta, `esConfiable`. Las dos hacen falta; ninguna sola alcanzó con los datos reales.) */
    const deriva: PuntoRecorrido[] = Array.from({ length: 240 }, (_, i) => ({
        lat: -34.8894 + Math.sin(i * 1.7) * 0.0006, lon: -56.1440 + Math.cos(i * 2.3) * 0.0006,
        cuando: new Date(T0 + i * 20_000).toISOString(), velocidad: 4 + (i % 5) * 4,
    }));
    const r = viajesYParadas(deriva);
    assert.equal(r.viajes.length, 0);
    assert.equal(resumenDeViajes(r.viajes, null, null, deriva.length).km, 0);
});

test("una vuelta de 300 m que sí se aleja es un viaje", () => {
    const r = viajesYParadas(tramo(0, 8, 30, -34.90));                       // ~630 m en línea recta
    assert.equal(r.viajes.length, 1);
});

test("los kilómetros del tramo son la suma de los viajes, no de los puntos", () => {
    const ida = tramo(0, 30, 36, -34.90);
    const quieto = tramo(300, 60, 0, -34.90 + 29 * 0.0009);
    const vuelta = tramo(900, 30, 36, -34.90 + 29 * 0.0009);
    const r = viajesYParadas([...ida, ...quieto, ...vuelta]);
    const s = resumenDeViajes(r.viajes, null, null, 120);
    assert.equal(s.km, Math.round((r.viajes[0].km + r.viajes[1].km) * 100) / 100);
    assert.equal(s.velMax, 36);
});

test("con pocos satélites la posición no es confiable", () => {
    assert.equal(esConfiable({ satelites: 5 }), false);
    assert.equal(esConfiable({ satelites: 7 }), false);
    assert.equal(esConfiable({ satelites: 8 }), true);
    assert.equal(esConfiable({}), true);          // un equipo que no informa satélites no se descarta por eso
});
