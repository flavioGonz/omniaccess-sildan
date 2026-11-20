import test from "node:test";
import assert from "node:assert/strict";
import { leerEstadoRele, puedeAccionarRele } from "@/lib/gps-rele";

const T = 1_800_000_000_000;
const hace = (min: number) => new Date(T - min * 60_000);

test("andando no se acciona, y dice a cuánto va", () => {
    const r = puedeAccionarRele({ velocidad: 62, cuando: hace(1), encendido: true, ultimoLatido: hace(1) }, T);
    assert.equal(r.ok, false); assert.match(r.motivo!, /62 km\/h/);
});

test("detenido con posición reciente se puede, aunque el motor esté regulando", () => {
    assert.equal(puedeAccionarRele({ velocidad: 0, cuando: hace(2), encendido: true, ultimoLatido: hace(1) }, T).ok, true);
});

test("bajo techo y con el motor apagado se puede (el caso del 20/11)", () => {
    assert.equal(puedeAccionarRele({ velocidad: 0, cuando: hace(180), encendido: false, ultimoLatido: hace(3) }, T).ok, true);
});

test("motor encendido y sin posición reciente: no, porque puede estar andando y no se ve", () => {
    const r = puedeAccionarRele({ velocidad: 0, cuando: hace(40), encendido: true, ultimoLatido: hace(2) }, T);
    assert.equal(r.ok, false); assert.match(r.motivo!, /motor está encendido/);
});

test("una velocidad vieja no prueba que esté quieto NI que esté andando: manda el motor", () => {
    // Iba a 80 hace una hora; ahora el latido dice motor apagado → está parado.
    assert.equal(puedeAccionarRele({ velocidad: 80, cuando: hace(60), encendido: false, ultimoLatido: hace(2) }, T).ok, true);
});

test("si no reporta, no se acciona a ciegas", () => {
    assert.equal(puedeAccionarRele({ velocidad: 0, cuando: hace(1), encendido: false, ultimoLatido: hace(30) }, T).ok, false);
    assert.equal(puedeAccionarRele({ velocidad: null, cuando: null, encendido: null, ultimoLatido: null }, T).ok, false);
});

test("lee el estado del relé de la respuesta real del equipo", () => {
    assert.equal(leerEstadoRele("RELAY : RESUME ,state:0"), false);
    assert.equal(leerEstadoRele("RELAY : CUT ,state:1"), true);
    assert.equal(leerEstadoRele("no entiendo"), null);
});
