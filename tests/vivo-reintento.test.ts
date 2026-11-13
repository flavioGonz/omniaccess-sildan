/** Cuándo se vuelve a probar un vivo que no arrancó (lib/vivo-reintento), y cuándo se avisa un corte general. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { esperaDeReintento, proximoIntento, esCorteGeneral, REINTENTAR_VIVO_MIN_MS, REINTENTAR_VIVO_MAX_MS } from "@/lib/vivo-reintento";

test("la primera espera es corta, se duplica y tiene techo", () => {
    assert.equal(esperaDeReintento(1), REINTENTAR_VIVO_MIN_MS);
    assert.equal(esperaDeReintento(2), REINTENTAR_VIVO_MIN_MS * 2);
    assert.equal(esperaDeReintento(3), REINTENTAR_VIVO_MIN_MS * 4);
    assert.equal(esperaDeReintento(5), REINTENTAR_VIVO_MAX_MS, "20 s × 16 ya pasa los 5 minutos");
    assert.equal(esperaDeReintento(40), REINTENTAR_VIVO_MAX_MS);
    assert.equal(esperaDeReintento(0), REINTENTAR_VIVO_MIN_MS, "nunca menos que la primera");
});

test("un corte de un minuto y medio no deja la pared cinco minutos en foto", () => {
    // Falla, se espera, vuelve a fallar…: ¿cuándo cae la primera prueba posterior a que vuelva el video (a los 90 s)?
    let t = 0, veces = 0;
    while (t < 90_000) { veces++; t += esperaDeReintento(veces); }
    assert.ok(t <= 150_000, `vuelve a probar a los ${t / 1000} s`);
    assert.ok(veces <= 3);
});

test("el azar corre la espera ±20 %, no más", () => {
    assert.equal(esperaDeReintento(1, 0), REINTENTAR_VIVO_MIN_MS * 0.8);
    assert.equal(esperaDeReintento(1, 1), REINTENTAR_VIVO_MIN_MS * 1.2);
    assert.equal(esperaDeReintento(1, 7), REINTENTAR_VIVO_MIN_MS * 1.2);
});

test("corte general: varias a la vez y media pantalla; dos cámaras rotas en una pared grande, no", () => {
    assert.equal(esCorteGeneral(13, 13), true);
    assert.equal(esCorteGeneral(8, 16), true);
    assert.equal(esCorteGeneral(2, 16), false);
    assert.equal(esCorteGeneral(7, 16), false);
    assert.equal(esCorteGeneral(3, 4), true);
    assert.equal(esCorteGeneral(2, 2), false, "con dos no alcanza para llamarlo general");
    assert.equal(esCorteGeneral(0, 0), false);
});

test("en un corte general se prueba seguido aunque ya haya fallado muchas veces", () => {
    const f = { desde: 1_000_000, veces: 6, azar: 0.5 };
    assert.equal(proximoIntento(f, false), 1_000_000 + REINTENTAR_VIVO_MAX_MS, "una cámara sola que no anda: cada 5 minutos");
    assert.equal(proximoIntento(f, true), 1_000_000 + REINTENTAR_VIVO_MIN_MS, "no llega ninguna: cada 20 s");
});
