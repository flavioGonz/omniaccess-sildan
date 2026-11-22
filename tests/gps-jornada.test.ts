/** La jornada, la velocidad sobre la línea y los excesos de un recorrido (lib/gps-jornada). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { franjasDe, indiceEnHora, jornadaPorDia, restoDelTrayecto, lineaDeTiempo, posicionEnLinea, rumboEntre, tiempoEnLinea, duracionLarga, excesosDe, franjaDe, jornadaDe, leerLimite, minutosEstacionado, puntoMasCercano, resumenDeExcesos, rumboEnPalabras, trozosPorVelocidad, type PuntoDeRuta } from "@/lib/gps-jornada";
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

test("la reproducción anda por el reloj del viaje: entre dos reportes el auto está en el medio", () => {
    const p = ruta([50, 50, 50, 50]);                       // un reporte cada diez segundos
    const l = lineaDeTiempo(p, 0, 3);
    assert.deepEqual(l.t, [0, 10, 20, 30]); assert.equal(l.total, 30);
    assert.equal(posicionEnLinea(l, 0), 0);
    assert.equal(posicionEnLinea(l, 5), 0.5);               // a mitad de camino entre el primero y el segundo
    assert.equal(posicionEnLinea(l, 24), 2.4);
    assert.equal(posicionEnLinea(l, 30), 3); assert.equal(posicionEnLinea(l, 99), 3);
    // Y al revés: dónde retomar si se soltó la barra en 2,4.
    assert.ok(Math.abs(tiempoEnLinea(l, 2.4) - 24) < 1e-9);
    assert.equal(tiempoEnLinea(l, 3), 30);
});

test("una espera no clava al auto, y entre dos viajes salta en vez de volar en línea recta", () => {
    const p = ruta([40, 0, 40, 40]);
    const mas = (i: number, seg: number) => { p[i].cuando = new Date(Date.parse(p[i - 1].cuando) + seg * 1000).toISOString(); };
    mas(1, 10); mas(2, 60); mas(3, 3 * 3600);               // un semáforo de un minuto, y tres horas hasta el viaje siguiente
    const l = lineaDeTiempo(p, 0, 3);
    assert.deepEqual(l.salto, [false, false, false, true]);
    assert.deepEqual(l.t, [0, 10, 22, 23.5]);               // el minuto cuenta doce segundos; las tres horas, un instante
    // En el salto el auto se queda en el punto 2 hasta que termina, y recién ahí aparece en el 3.
    assert.equal(posicionEnLinea(l, 22.7), 2);
    assert.equal(posicionEnLinea(l, 23.5), 3);
});

test("recorrer sólo un viaje: la línea arranca en su primer punto", () => {
    const l = lineaDeTiempo(ruta([10, 20, 30, 40, 50]), 2, 4);
    assert.equal(l.desde, 2); assert.equal(l.total, 20);
    assert.equal(posicionEnLinea(l, 0), 2); assert.equal(posicionEnLinea(l, 15), 3.5); assert.equal(posicionEnLinea(l, 20), 4);
    assert.equal(tiempoEnLinea(l, 2), 0); assert.equal(tiempoEnLinea(l, 1), 0);     // antes del comienzo es el comienzo
});

test("el rumbo sale del tramo que se anda, y quieto no hay rumbo", () => {
    const a = { lat: -34.9, lon: -56.1 };
    assert.ok(Math.abs(rumboEntre(a, { lat: -34.89, lon: -56.1 })!) < 0.01);                // al norte
    assert.ok(Math.abs(rumboEntre(a, { lat: -34.9, lon: -56.09 })! - 90) < 0.01);           // al este
    assert.ok(Math.abs(rumboEntre(a, { lat: -34.91, lon: -56.1 })! - 180) < 0.01);          // al sur
    assert.equal(rumboEntre(a, { lat: -34.90001, lon: -56.1 }), null);                      // un metro: es ruido
});

test("la jornada por día: un encabezado por día con sus viajes, kilómetros y tiempo andando", () => {
    const dia = (iso: string) => new Date(Date.parse(iso) - 3 * 3600e3).toISOString().slice(0, 10);      // el día en Montevideo
    const v = (d: string, desde: string, hasta: string): Viaje => ({ ...viaje(desde, hasta, CASA, OBRA), desde: `${d}T${desde}.000Z`, hasta: `${d}T${hasta}.000Z` });
    const j = jornadaDe([v("2026-11-20", "11:10:00", "11:40:00"), v("2026-11-20", "20:40:00", "21:15:00"), v("2026-11-21", "12:00:00", "12:30:00")], { desde: "2026-11-20T03:00:00.000Z", hasta: "2026-11-21T15:00:00.000Z" });
    const d = jornadaPorDia(j, dia);
    assert.deepEqual(d.map((x) => [x.dia, x.viajes, x.km, x.andandoMin]), [["2026-11-20", 2, 20, 60], ["2026-11-21", 1, 10, 30]]);
    // Lo estacionado de la noche del 20 al 21 va en el día en que empezó.
    assert.deepEqual(d[0].tramos.map((t) => t.tipo), ["estacionado", "viaje", "estacionado", "viaje", "estacionado"]);
    assert.deepEqual(d[1].tramos.map((t) => t.tipo), ["viaje", "estacionado"]);
});

test("ubicar una hora sobre el trayecto: el reporte más cercano", () => {
    const p = ruta([10, 20, 30, 40, 50]);                    // 12:00:00, :10, :20, :30, :40
    assert.equal(indiceEnHora(p, h("12:00:14")), 1);
    assert.equal(indiceEnHora(p, h("12:00:16")), 2);
    assert.equal(indiceEnHora(p, h("11:00:00")), 0); assert.equal(indiceEnHora(p, h("13:00:00")), 4);
    assert.equal(indiceEnHora(p, h("12:00:40"), 1, 3), 3);  // acotado a un viaje
    assert.equal(indiceEnHora([], h("12:00:00")), -1);
});

test("lo que queda por recorrer: desde donde está el auto, y un viaje por línea", () => {
    const p = ruta([10, 20, 30, 40, 50, 60]);
    const viajes = [{ i0: 0, i1: 2 }, null, { i0: 3, i1: 5 }];
    const r = restoDelTrayecto(p, viajes, 1.5, 5);
    assert.equal(r.length, 2);
    // El primero arranca a mitad de camino entre el punto 1 y el 2, y termina en el 2.
    assert.equal(r[0].length, 2); assert.ok(Math.abs(r[0][0][0] - (p[1].lat + p[2].lat) / 2) < 1e-9);
    assert.equal(r[1].length, 3);                            // el segundo viaje, entero
    assert.deepEqual(restoDelTrayecto(p, viajes, 5, 5), []); // al final no queda nada
    assert.equal(restoDelTrayecto(p, viajes, 0, 2).length, 1);   // recorriendo sólo el primer viaje
});

test("la leyenda dice las franjas con el límite de la empresa", () => {
    assert.deepEqual(franjasDe(90).map((f) => f.rotulo), ["hasta 36", "36 a 77", "77 a 90", "más de 90"]);
});
