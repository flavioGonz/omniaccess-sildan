/** El auto quieto frente a la LPR (lib-chapa-quieta). Los números salen de lo medido el 17/11. */
import { test } from "node:test";
import assert from "node:assert/strict";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { esElMismoQuieto, recordar, caja, TOLERANCIA, VENTANA_MS, RECUERDO } = require("../lib-chapa-quieta.js");

const r = (x: number, y: number, w = 26, h = 14) => ({ x, y, w, h });
const SEG = 1000;

test("el recuadro del auto estacionado, medido: ±1 px en dos horas", () => {
    // Lecturas reales de SCM2419 en «LPR Salida», una cada ~22 s.
    const reales = [r(734, 233, 26, 13), r(734, 232, 22, 16), r(733, 233, 27, 14), r(734, 233, 26, 14)];
    for (let i = 1; i < reales.length; i++) {
        assert.equal(esElMismoQuieto(reales[i - 1], reales[i], 22 * SEG), true, `lectura ${i}`);
    }
});

test("los que pasaron se mueven decenas o cientos de píxeles", () => {
    const pasadas = [r(317, 444, 46, 19), r(467, 516, 59, 37), r(272, 450, 43, 17)];
    assert.equal(esElMismoQuieto(pasadas[0], pasadas[1], 60 * SEG), false);
    assert.equal(esElMismoQuieto(pasadas[1], pasadas[2], 60 * SEG), false);
});

test("mismo lugar pero dos días después: NO es la misma parada", () => {
    assert.equal(esElMismoQuieto(r(734, 233), r(734, 233), 47 * 3600 * SEG), false);
    // El borde de la ventana.
    assert.equal(esElMismoQuieto(r(734, 233), r(734, 233), VENTANA_MS), true);
    assert.equal(esElMismoQuieto(r(734, 233), r(734, 233), VENTANA_MS + 1), false);
});

test("el borde de la tolerancia", () => {
    assert.equal(esElMismoQuieto(r(734, 233), r(734 + TOLERANCIA, 233), 20 * SEG), true);
    assert.equal(esElMismoQuieto(r(734, 233), r(734 + TOLERANCIA + 1, 233), 20 * SEG), false);
    assert.equal(esElMismoQuieto(r(734, 233), r(734, 233 + TOLERANCIA + 1), 20 * SEG), false);
});

test("sin recuadro no se decide nada: queda el antirrebote de siempre", () => {
    assert.equal(esElMismoQuieto(null, r(734, 233), 20 * SEG), false);
    assert.equal(esElMismoQuieto(r(734, 233), null, 20 * SEG), false);
    assert.equal(esElMismoQuieto({ x: 1 }, r(734, 233), 20 * SEG), false);
    assert.equal(caja({ x: "a", y: 1, w: 1, h: 1 }), null);
});

test("un reloj corrido hacia atrás no encadena nada", () => {
    assert.equal(esElMismoQuieto(r(734, 233), r(734, 233), -5 * SEG), false);
});

test("un auto quieto que alterna entre varios recuadros sigue siendo el mismo (medido 17/11)", () => {
    // «LPR Salida» mandaba tres posiciones estables del mismo auto parado, según qué foto del
    // aviso traía el recuadro: 733/233, 941/256 y 957/259.
    const tres = [r(733, 233), r(941, 256, 28, 21), r(957, 259, 28, 22)];
    let memoria: unknown[] = [];
    let quietas = 0;
    for (const c of [...tres, ...tres, ...tres]) {
        if (esElMismoQuieto(memoria, c, 22 * SEG)) quietas++;
        memoria = recordar(memoria, c);
    }
    // Las tres primeras abren cada posición; las seis siguientes ya son conocidas.
    assert.equal(quietas, 6);
});

test("recordar no repite la misma posición ni guarda más de RECUERDO", () => {
    let m = recordar([], r(733, 233));
    m = recordar(m, r(734, 233));           // la misma, ±1
    assert.equal(m.length, 1);
    for (const x of [r(100, 100), r(200, 200), r(300, 300), r(400, 400)]) m = recordar(m, x);
    assert.equal(m.length, RECUERDO);
});
