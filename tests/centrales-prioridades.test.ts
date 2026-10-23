/** Prioridad de los eventos de las centrales (lib/centrales/prioridades). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { claseDe, claseDeAlarma, leerPrioridades, prioridadDe, PRIORIDADES_DEFECTO } from "@/lib/centrales/prioridades";
const cod = require("../lib-dc09-codigos");

test("las de fábrica son las que pidió Nico: robo y pánico 1, sabotaje 2, fallos 4", () => {
    const p = PRIORIDADES_DEFECTO;
    assert.equal(prioridadDe(p, cod.traducirCid("1130 01 010")[0]), 1);
    assert.equal(prioridadDe(p, cod.traducirCid("1120 01 000")[0]), 1);
    assert.equal(prioridadDe(p, cod.traducirCid("1137 01 002")[0]), 2);
    assert.equal(prioridadDe(p, cod.traducirCid("1301 00 000")[0]), 4);
    assert.equal(prioridadDe(p, cod.traducirCid("3130 01 010")[0]), 5, "la restauración es informativa");
    assert.equal(prioridadDe(p, cod.traducirCid("1401 01 005")[0]), 5);
});
test("clases: robo perimetral es robo; gas es técnica; una alarma de central por su eventType", () => {
    assert.equal(claseDe(cod.traducirCid("1131 01 003")[0]), "ROBO");
    assert.equal(claseDe(cod.traducirCid("1151 01 003")[0]), "TECNICA");
    assert.equal(claseDeAlarma("SABOTAJE"), "SABOTAJE");
    assert.equal(claseDeAlarma("GAS"), "TECNICA");
});
test("lo guardado pisa lo de fábrica, y lo inválido se ignora", () => {
    const p = leerPrioridades(JSON.stringify({ FALLA: 2, ROBO: 9, NADA: 1 }));
    assert.equal(p.FALLA, 2); assert.equal(p.ROBO, 1); assert.equal((p as any).NADA, undefined);
    assert.deepEqual(leerPrioridades("no es json"), PRIORIDADES_DEFECTO);
});
