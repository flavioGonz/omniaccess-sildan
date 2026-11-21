import test from "node:test";
import assert from "node:assert/strict";
import { enHorario, estimarFin, GOTEO_DEFECTO, horaEn, leerGoteo, proximoEnvio, queToca, type Goteo } from "@/lib/censo-goteo";

const ZONA = "America/Montevideo";                       // UTC-3, sin horario de verano
const a = (iso: string) => new Date(iso);
const g = (x: Partial<Goteo> = {}): Goteo => ({ ...GOTEO_DEFECTO, activo: true, ...x });

test("la hora se mira en la zona del barrio, no en la del servidor", () => {
    assert.equal(horaEn(a("2026-11-23T12:00:00Z"), ZONA), 9);
    assert.equal(horaEn(a("2026-11-23T02:30:00Z"), ZONA), 23.5);
});

test("apagado no manda; fuera de hora no manda; antes de tiempo espera; si no, manda", () => {
    const ahora = a("2026-11-23T13:00:00Z");              // 10:00 en Montevideo
    assert.equal(queToca(g({ activo: false }), ahora, ZONA), "apagado");
    assert.equal(queToca(g(), a("2026-11-23T11:59:00Z"), ZONA), "fuera-de-hora");   // 08:59
    assert.equal(queToca(g(), a("2026-11-23T23:00:00Z"), ZONA), "fuera-de-hora");   // 20:00: ya cerró
    assert.equal(queToca(g({ proximo: "2026-11-23T13:00:30Z" }), ahora, ZONA), "espera");
    assert.equal(queToca(g({ proximo: "2026-11-23T12:59:59Z" }), ahora, ZONA), "enviar");
    assert.equal(queToca(g(), ahora, ZONA), "enviar");    // sin «próximo»: en cuanto se pueda
    assert.ok(enHorario(g(), a("2026-11-23T12:00:00Z"), ZONA));                     // las 9 en punto ya es horario
});

test("la pausa nunca es exacta: entre el 70 % y el 130 % del ritmo", () => {
    const ahora = a("2026-11-23T13:00:00Z");
    assert.equal(proximoEnvio(g({ cadaSeg: 60 }), ahora, () => 0).getTime() - ahora.getTime(), 42_000);
    assert.equal(proximoEnvio(g({ cadaSeg: 60 }), ahora, () => 0.5).getTime() - ahora.getTime(), 60_000);
    assert.equal(proximoEnvio(g({ cadaSeg: 60 }), ahora, () => 1).getTime() - ahora.getTime(), 78_000);
    // Con el azar de verdad, cien pausas no dan todas lo mismo y ninguna se sale del rango.
    const pausas = Array.from({ length: 100 }, () => proximoEnvio(g({ cadaSeg: 60 }), ahora).getTime() - ahora.getTime());
    assert.ok(new Set(pausas).size > 50); assert.ok(pausas.every((p) => p >= 42_000 && p <= 78_000));
});

test("490 a uno por minuto, arrancando el lunes a las 9: termina el mismo lunes a las 17:10", () => {
    const fin = estimarFin(g({ cadaSeg: 60 }), 490, a("2026-11-23T12:00:00Z"), ZONA)!;
    assert.equal(fin.toISOString(), "2026-11-23T20:10:00.000Z");                   // 17:10 en Montevideo
});

test("lo que no entra hoy sigue mañana a la hora de arranque, no de madrugada", () => {
    // Uno cada 2 minutos: 490 × 2 min = 16 h 20 min; la ventana tiene 11 h. Quedan 5 h 20 min para el martes.
    const fin = estimarFin(g({ cadaSeg: 120 }), 490, a("2026-11-23T12:00:00Z"), ZONA)!;
    assert.equal(fin.toISOString(), "2026-11-24T17:20:00.000Z");                   // martes 14:20
    // Arrancando de noche: empieza a contar a las 9 de la mañana siguiente.
    const tarde = estimarFin(g({ cadaSeg: 60 }), 60, a("2026-11-24T01:00:00Z"), ZONA)!;   // lunes 22:00
    assert.equal(tarde.toISOString(), "2026-11-24T13:00:00.000Z");                 // martes 10:00
    assert.equal(estimarFin(g(), 0, a("2026-11-23T12:00:00Z"), ZONA), null);
});

test("lo guardado se lee con cuidado: basura, un ritmo de locos o un horario al revés no pasan", () => {
    assert.deepEqual(leerGoteo("esto no es json"), GOTEO_DEFECTO);
    assert.equal(leerGoteo({ cadaSeg: 1 }).cadaSeg, 30);                            // más rápido que 30 s no es «de a poco»
    assert.equal(leerGoteo({ activo: "true" }).activo, false);                      // sólo un true de verdad lo prende
    const alReves = leerGoteo({ desde: 20, hasta: 9 });
    assert.deepEqual([alReves.desde, alReves.hasta], [9, 20]);
    assert.equal(leerGoteo({ origen: "https://omniaccess.ies.com.uy" }).origen, "https://omniaccess.ies.com.uy");
    assert.equal(leerGoteo({ origen: "javascript:alert(1)" }).origen, "");
    assert.equal(leerGoteo({ origen: "https://sitio.uy/con/camino" }).origen, "");
});
