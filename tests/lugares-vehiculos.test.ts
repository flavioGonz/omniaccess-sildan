/** Cuánto lleva un vehículo en su lugar (lib-lugares-vehiculos.js) y cómo se cruza con el vivo (lib/vision-estadia). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { conEstadia, textoEstadia, CRUCE_IOU } from "@/lib/vision-estadia";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const L = require("../lib-lugares-vehiculos.js");

const AUTO: number[] = [0.50, 0.10, 0.66, 0.30];
const OTRO: number[] = [0.80, 0.05, 0.95, 0.35];
const corrida = (c: number[], d: number) => [c[0] + d, c[1], c[2] + d, c[3]];
const T0 = 1_800_000_000_000, MIN = 60_000;

test("un auto estacionado es UN lugar aunque se lo mire una vez por minuto", () => {
    // Lo medido en el lab: con la escena quieta el cuadro se analiza cada 60 s y la pista del
    // registro se cierra a los 15. El lugar no depende de eso.
    let l: any[] = [];
    for (let i = 0; i <= 100; i++) l = L.actualizar(l, [corrida(AUTO, (i % 3) * 0.004)], T0 + i * MIN);
    assert.equal(l.length, 1);
    assert.equal(l[0].desde, T0);
    const p = L.publicar(l, T0 + 100 * MIN);
    assert.equal(p.length, 1);
    assert.equal(p[0][4], T0);
});

test("lo que pasa de largo no se publica como estacionado", () => {
    let l: any[] = [];
    for (let i = 0; i < 20; i++) l = L.actualizar(l, [corrida(AUTO, i * 0.03)], T0 + i * 500);
    assert.equal(L.publicar(l, T0 + 10_000).length, 0);
    // Y los lugares que dejó en el camino se van solos.
    l = L.actualizar(l, [], T0 + 7 * MIN);
    assert.equal(l.length, 0);
});

test("un camión que lo tapa unos segundos no le reinicia el reloj", () => {
    let l: any[] = [];
    for (let i = 0; i <= 10; i++) l = L.actualizar(l, [AUTO], T0 + i * MIN);
    // 20 cuadros seguidos sin verlo, en 10 segundos (la escena se mueve: se analiza seguido).
    for (let i = 1; i <= 20; i++) l = L.actualizar(l, [[0.3, 0.0, 0.9, 0.6]], T0 + 10 * MIN + i * 500);
    l = L.actualizar(l, [AUTO], T0 + 10 * MIN + 12_000);
    const auto = l.find((x) => L.iou(x.caja, AUTO) > 0.9);
    assert.ok(auto, "el auto sigue anotado");
    assert.equal(auto.desde, T0);
});

test("cuando se va, el que estaciona después en el mismo lugar arranca de cero", () => {
    let l: any[] = [];
    for (let i = 0; i <= 30; i++) l = L.actualizar(l, [AUTO], T0 + i * MIN);
    // Se va: la escena se mueve y se analiza seguido, sin él, durante un minuto.
    const fin = T0 + 30 * MIN;
    for (let i = 1; i <= 30; i++) l = L.actualizar(l, [], fin + i * 2000);
    assert.equal(l.length, 0, "se dio por ido");
    l = L.actualizar(l, [AUTO], fin + 2 * MIN);
    assert.equal(l[0].desde, fin + 2 * MIN);
});

test("con la escena quieta, no verlo en un cuadro suelto no alcanza para borrarlo", () => {
    let l: any[] = [];
    for (let i = 0; i <= 5; i++) l = L.actualizar(l, [AUTO], T0 + i * MIN);
    // De noche el detector lo pierde en dos miradas (una por minuto) y vuelve.
    l = L.actualizar(l, [], T0 + 6 * MIN);
    l = L.actualizar(l, [], T0 + 7 * MIN);
    l = L.actualizar(l, [AUTO], T0 + 8 * MIN);
    assert.equal(l.length, 1);
    assert.equal(l[0].desde, T0);
});

test("al reiniciar el proceso, los relojes se heredan; una foto vieja no", () => {
    let l: any[] = [];
    for (let i = 0; i <= 5; i++) l = L.actualizar(l, [AUTO, OTRO], T0 + i * MIN);
    const foto = { t: new Date(T0 + 5 * MIN).toISOString(), camaras: { cam1: L.publicar(l, T0 + 5 * MIN) } };
    const h = L.heredar(foto, T0 + 6 * MIN);
    assert.equal(h.cam1.length, 2);
    const seguido = L.actualizar(h.cam1, [AUTO, OTRO], T0 + 6 * MIN);
    assert.deepEqual(seguido.map((x: any) => x.desde), [T0, T0]);
    assert.deepEqual(L.heredar(foto, T0 + 5 * MIN + L.HEREDAR_MS + 1), {});
    assert.deepEqual(L.heredar(null, T0), {});
});

test("en el vivo, cada auto toma el reloj de su lugar y no el del vecino", () => {
    const lugares: any = [[...AUTO, T0], [...OTRO, T0 + 5 * MIN]];
    const objetos = [
        { grupo: "vehiculo", caja: corrida(AUTO, 0.01), nombre: "auto" },
        { grupo: "vehiculo", caja: corrida(OTRO, -0.01), nombre: "auto" },
        { grupo: "persona", caja: AUTO, nombre: "persona" },
        { grupo: "vehiculo", caja: [0.1, 0.6, 0.3, 0.9], nombre: "auto que recién llega" },
    ];
    const r = conEstadia(objetos, lugares);
    assert.equal(r[0].quietoDesde, T0);
    assert.equal(r[1].quietoDesde, T0 + 5 * MIN);
    assert.equal(r[2].quietoDesde, undefined, "una persona parada delante no hereda el reloj del auto");
    assert.equal(r[3].quietoDesde, undefined);
    assert.equal(conEstadia(objetos, undefined), objetos);
    assert.ok(CRUCE_IOU < L.MISMO_LUGAR_IOU);
});

test("el tiempo, corto", () => {
    assert.equal(textoEstadia(70_000), "1 min");
    assert.equal(textoEstadia(41 * MIN), "41 min");
    assert.equal(textoEstadia(101 * MIN), "1 h 41");
    assert.equal(textoEstadia(125 * MIN), "2 h 05");
    assert.equal(textoEstadia(27 * 60 * MIN), "1 d 3 h");
});
