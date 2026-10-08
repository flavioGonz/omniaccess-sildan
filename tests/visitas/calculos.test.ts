import test from "node:test";
import assert from "node:assert/strict";
import { mediana, percentil, detectarRutina, describirRutina, claseDe, fueraDeRutina, enFranja, enZona, duracion, describirDias, distanciaMin } from "../../src/lib/visitas/calculos.ts";

test("mediana y p90 como percentile_cont", () => {
    assert.equal(mediana([10, 20, 30]), 20);
    assert.equal(mediana([10, 20, 30, 40]), 25);
    assert.equal(percentil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9.1);
    assert.equal(mediana([]), null);
});

test("rutina medida: lun a vie entre 06:48 y 06:53", () => {
    const ll = [[1, 408], [2, 410], [3, 411], [4, 413], [5, 409], [1, 410]].map(([dow, minuto]) => ({ dow, minuto }));
    const r = detectarRutina(ll, 4, 30)!;
    assert.ok(r, "hay rutina");
    assert.deepEqual(r.dows, [1, 2, 3, 4, 5]);
    assert.equal(describirRutina(r), "lun a vie · 06:50 ±2 min");
});

test("sin rutina: pocos días o mucha variación", () => {
    assert.equal(detectarRutina([{ dow: 1, minuto: 400 }, { dow: 2, minuto: 401 }, { dow: 3, minuto: 402 }], 4, 30), null);
    assert.equal(detectarRutina([{ dow: 1, minuto: 400 }, { dow: 2, minuto: 600 }, { dow: 3, minuto: 900 }, { dow: 4, minuto: 1200 }], 4, 30), null);
});

test("clases", () => {
    assert.equal(claseDe({ enPadron: true, rutina: null, diasVistos: 1 }), "RESIDENTE");
    assert.equal(claseDe({ enPadron: false, rutina: { dows: [1], minutoMedio: 1, desvioMin: 1, dias: 4 }, diasVistos: 4 }), "HABITUAL");
    assert.equal(claseDe({ enPadron: false, rutina: null, diasVistos: 5 }), "FRECUENTE");
    assert.equal(claseDe({ enPadron: false, rutina: null, diasVistos: 3 }), "OCASIONAL");
    assert.equal(claseDe({ enPadron: false, rutina: null, diasVistos: 1 }), "PRIMERA_VEZ");
});

test("fuera de rutina: domingo de madrugada y hora lejana", () => {
    const r = { dows: [1, 2, 3, 4, 5], minutoMedio: 410, desvioMin: 2, dias: 6 };
    assert.deepEqual(fueraDeRutina(r, { dow: 7, minuto: 190 }, 90)?.por, "dia");
    assert.equal(fueraDeRutina(r, { dow: 2, minuto: 190 }, 90)?.por, "hora");
    assert.equal(fueraDeRutina(r, { dow: 2, minuto: 450 }, 90), null, "40 min tarde no es fuera de rutina");
});

test("franja que cruza la medianoche", () => {
    assert.equal(enFranja(150, "23:00", "06:00"), true);
    assert.equal(enFranja(23 * 60 + 30, "23:00", "06:00"), true);
    assert.equal(enFranja(12 * 60, "23:00", "06:00"), false);
    assert.equal(enFranja(10 * 60, "08:00", "18:00"), true);
});

test("hora del barrio y distancias", () => {
    // 2026-10-08 09:50 UTC = 06:50 en Montevideo, jueves
    assert.deepEqual(enZona(new Date("2026-10-08T09:50:00Z"), "America/Montevideo"), { dow: 4, minuto: 410 });
    assert.equal(distanciaMin(1430, 10), 20);
    assert.equal(duracion(139), "2 h 19 min");
    assert.equal(describirDias([1, 3, 5]), "lun, mié, vie");
    assert.equal(describirDias([1, 2, 3, 4, 5, 6, 7]), "todos los días");
});

test("sólo salidas → entrada no vista (pero cuenta para la rutina)", async () => {
    const { entradaNoVista, detectarRutina } = await import("../../src/lib/visitas/calculos.ts");
    assert.equal(entradaNoVista({ entradas: 0, salidas: 40 }), true);
    assert.equal(entradaNoVista({ entradas: 1, salidas: 40 }), false);
    assert.equal(entradaNoVista({ entradas: 0, salidas: 0 }), false);
    // Las mismas primeras lecturas del día, vengan de la cámara que vengan, dan la rutina.
    assert.ok(detectarRutina([1, 2, 3, 4, 5].map((dow) => ({ dow, minuto: 1150 + dow })), 4, 30));
});
