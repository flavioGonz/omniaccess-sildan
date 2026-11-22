/** Compartir la posición de un rastreador (lib/gps-compartir). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoDeEnlace, horasValidas, quedaLegible } from "@/lib/gps-compartir";

const AHORA = new Date("2026-11-23T12:00:00Z");
const en = (min: number) => new Date(AHORA.getTime() + min * 60_000);

test("un enlace dura entre una hora y una semana, pidan lo que pidan", () => {
    assert.equal(horasValidas(4), 4);
    assert.equal(horasValidas(0), 1);
    assert.equal(horasValidas("abc"), 1);
    assert.equal(horasValidas(24 * 365), 168);
});

test("vigente, vencido o cortado — y cortado gana aunque no haya vencido", () => {
    assert.equal(estadoDeEnlace({ venceAt: en(60) }, AHORA), "vigente");
    assert.equal(estadoDeEnlace({ venceAt: en(-1) }, AHORA), "vencido");
    assert.equal(estadoDeEnlace({ venceAt: en(0) }, AHORA), "vencido");            // justo en la hora ya no vale
    assert.equal(estadoDeEnlace({ venceAt: en(600), revocadoAt: en(-5) }, AHORA), "cortado");
});

test("cuánto le queda, como se dice", () => {
    assert.equal(quedaLegible(en(0.5), AHORA), "menos de un minuto");
    assert.equal(quedaLegible(en(45), AHORA), "45 min");
    assert.equal(quedaLegible(en(200), AHORA), "3 h 20 min");
    assert.equal(quedaLegible(en(60 * 20), AHORA), "20 h");
    assert.equal(quedaLegible(en(60 * 24 * 3), AHORA), "3 días");
});
