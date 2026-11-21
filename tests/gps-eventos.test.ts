import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { EVENTOS_GPS, EVENTOS_DE_LA_APLICACION, demoraLegible, plegarEventos, tiposDeClase, tituloDeEventoGps } from "@/lib/gps-eventos";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const receptor = require(path.join(__dirname, "..", "lib-gps-eventos.js"));

test("la pantalla y el receptor conocen los mismos eventos", () => {
    const delReceptor = Object.keys(receptor.ROTULO).sort();
    const dePantalla = Object.keys(EVENTOS_GPS).filter((t) => !EVENTOS_DE_LA_APLICACION.includes(t)).sort();
    assert.deepEqual(dePantalla, delReceptor);
});

test("todo lo que abre un caso en la consola existe para la pantalla", () => {
    for (const t of [...Object.keys(receptor.PRIORIDAD), "GPS_SIN_REPORTE"]) assert.ok(EVENTOS_GPS[t], t);
    assert.ok(tiposDeClase("conexion").includes("GPS_SIN_REPORTE"));
});

test("un cruce de geocerca lleva el nombre de la zona en el título", () => {
    assert.deepEqual(tituloDeEventoGps({ tipo: "GPS_GEOCERCA_ENTRA", detalle: "Base" }), { titulo: "Entró a Base", resto: null });
    assert.deepEqual(tituloDeEventoGps({ tipo: "GPS_GEOCERCA_SALE", detalle: "Taller" }), { titulo: "Salió de Taller", resto: null });
    assert.deepEqual(tituloDeEventoGps({ tipo: "GPS_BATERIA", detalle: "11,6 V" }), { titulo: "Batería del vehículo baja", resto: "11,6 V" });
    assert.deepEqual(tituloDeEventoGps({ tipo: "GPS_SOS", detalle: null }), { titulo: "Botón de pánico (SOS)", resto: null });
});

test("la demora se dice en minutos y horas, y a tiempo no se dice", () => {
    assert.equal(demoraLegible(0), null);
    assert.equal(demoraLegible(null), null);
    assert.equal(demoraLegible(540), "9 min");
    assert.equal(demoraLegible(4800), "1 h 20 min");
});

test("62 vibraciones no tapan un corte: las rachas de ruido se pliegan, las alarmas no", () => {
    const e = (id: string, tipo: string) => ({ id, tipo, cuando: "2026-11-21T00:00:00Z" });
    const lista = [
        e("1", "GPS_VIBRACION"), e("2", "GPS_VIBRACION"), e("3", "GPS_VIBRACION"), e("4", "GPS_VIBRACION"),
        e("5", "GPS_CORTE"),
        e("6", "GPS_VIBRACION"), e("7", "GPS_VIBRACION"),
        e("8", "GPS_SIN_SATELITES"), e("9", "GPS_CON_SATELITES"), e("10", "GPS_SIN_SATELITES"),
        e("11", "GPS_SOS"), e("12", "GPS_SOS"), e("13", "GPS_SOS"),
    ];
    const g = plegarEventos(lista);
    assert.deepEqual(g.map((x) => x.eventos.length), [4, 1, 1, 1, 3, 1, 1, 1]);
    // El orden no cambia y no se pierde ninguno.
    assert.deepEqual(g.flatMap((x) => x.eventos.map((y) => y.id)), lista.map((x) => x.id));
    // Dos vibraciones sueltas no son una racha.
    assert.equal(g[2].eventos[0].id, "6");
    // Tres SOS son tres SOS.
    assert.equal(g[5].eventos[0].tipo, "GPS_SOS");
});
