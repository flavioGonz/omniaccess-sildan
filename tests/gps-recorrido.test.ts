import test from "node:test";
import assert from "node:assert/strict";
import { aligerar, metrosEntre, resumenDeRecorrido, type PuntoRecorrido } from "@/lib/gps-recorrido";

const T0 = Date.parse("2026-11-20T12:00:00Z");
const p = (lat: number, lon: number, seg: number, velocidad: number): PuntoRecorrido => ({ lat, lon, cuando: new Date(T0 + seg * 1000).toISOString(), velocidad });

test("la distancia entre dos puntos conocidos", () => {
    // Un grado de latitud son ~111,2 km.
    const d = metrosEntre({ lat: -34, lon: -56 }, { lat: -35, lon: -56 });
    assert.ok(Math.abs(d - 111195) < 200, String(d));
});

test("un auto estacionado NO recorre kilómetros por el ruido del GPS (el caso real del 20/11)", () => {
    // Las tres posiciones reales del equipo quieto, a ~15 m una de otra, y muchas más iguales.
    const quieto: PuntoRecorrido[] = [];
    for (let i = 0; i < 200; i++) quieto.push(p(-34.889414 + (i % 3) * 0.0001, -56.144064 + (i % 2) * 0.0001, i * 10, 0));
    const r = resumenDeRecorrido(quieto);
    assert.equal(r.km, 0); assert.equal(r.enMovimientoMin, 0); assert.equal(r.velMax, 0);
});

test("un viaje suma distancia, tiempo en movimiento y velocidad máxima", () => {
    // 10 reportes cada 10 s avanzando ~100 m por reporte (36 km/h).
    const viaje = Array.from({ length: 10 }, (_, i) => p(-34.9 + i * 0.0009, -56.15, i * 10, 36));
    const r = resumenDeRecorrido(viaje);
    assert.ok(r.km > 0.85 && r.km < 0.95, String(r.km));
    assert.equal(r.enMovimientoMin, 2);       // 90 s → redondea a 2
    assert.equal(r.velMax, 36);
});

test("una hora sin reportar en el medio no cuenta como tiempo en movimiento", () => {
    const r = resumenDeRecorrido([p(-34.9, -56.15, 0, 40), p(-34.95, -56.15, 3600, 40)]);
    assert.ok(r.km > 5);                       // el traslado existió
    assert.equal(r.enMovimientoMin, 0);        // pero no se sabe cuánto de esa hora anduvo
});

test("aligerar conserva el primero y el último", () => {
    const todos = Array.from({ length: 10000 }, (_, i) => i);
    const r = aligerar(todos, 500);
    assert.equal(r.length, 500); assert.equal(r[0], 0); assert.equal(r[499], 9999);
    assert.equal(aligerar([1, 2, 3], 500).length, 3);
});
