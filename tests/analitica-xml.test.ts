/** Reglas de analítica (varias líneas y zonas) sobre el XML real de cámaras del lab (lib/analitica-xml). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import { leerReglas, aplicarCambios, diferencias, validarCambios } from "@/lib/analitica-xml";

const xml = (n: string) => readFileSync(join(__dirname, "fixtures", "analitica", `${n}.xml`), "utf8");

test("lee las 4 líneas: la 1 de Cairoli está dibujada y activa (manda la raíz)", () => {
    const l = leerReglas(xml("cairoli-LineDetection"), "linea");
    assert.equal(l.max, 4);
    assert.equal(l.reglas.length, 4);
    assert.equal(l.raiz, true);
    const [uno, dos] = l.reglas;
    assert.deepEqual(uno.points, [{ x: 517, y: 371 }, { x: 850, y: 607 }]);
    assert.equal(uno.vacia, false);
    assert.equal(uno.enabled, true, "el <enabled> propio dice false, pero la cámara lo ignora: manda la raíz");
    assert.equal(uno.objetivo, "vehicle");
    assert.equal(uno.direction, "both");
    assert.equal(dos.vacia, true);
});

test("las líneas vacías con (0,0) también se reconocen", () => {
    const l = leerReglas(xml("cerco-LineDetection"), "linea");
    assert.equal(l.reglas.filter((r) => r.vacia).length, 3);
});

test("zona: las vacías no traen coordenadas; la 1 de Cairoli tiene 4 vértices", () => {
    const z = leerReglas(xml("cairoli-FieldDetection"), "zona");
    assert.equal(z.max, 4);
    assert.equal(z.reglas[0].points.length, 4);
    assert.equal(z.reglas[0].tiempo, 0);
    assert.equal(z.reglas[0].sensibilidad, 60);
    assert.ok(z.reglas.slice(1).every((r) => r.vacia));
});

test("agregar dos líneas prende cada elemento y la raíz", () => {
    const antes = xml("depo-LineDetection");
    const pedido = [
        { id: 1, points: [{ x: 100, y: 200 }, { x: 900, y: 300 }], direction: "ab" as const, objetivo: "human", sensibilidad: 60 },
        { id: 3, points: [{ x: 10, y: 990 }, { x: 500, y: 500 }] },
    ];
    const despues = aplicarCambios(antes, "linea", pedido);
    const l = leerReglas(despues, "linea");
    assert.equal(l.raiz, true);
    assert.equal(l.reglas[0].enabled, true);
    assert.equal(l.reglas[0].direction, "ab");
    assert.equal(l.reglas[0].sensibilidad, 60);
    assert.equal(l.reglas[2].enabled, true);
    assert.equal(l.reglas[1].vacia, true);
    assert.deepEqual(diferencias(pedido, l.reglas), []);
    // Lo que no se tocó queda igual (confianza, isSupportMultiScene…).
    assert.match(despues, /<recogRuleType>vectorMode<\/recogRuleType>/);
    assert.equal((despues.match(/<alarmConfidence/g) || []).length, 4);
});

test("borrar deja la línea como de fábrica y apaga la raíz si no queda ninguna", () => {
    const con = aplicarCambios(xml("depo-LineDetection"), "linea", [{ id: 2, points: [{ x: 1, y: 2 }, { x: 300, y: 400 }] }]);
    const sin = aplicarCambios(con, "linea", [{ id: 2, borrar: true }]);
    const l = leerReglas(sin, "linea");
    assert.equal(l.reglas[1].vacia, true);
    assert.equal(l.reglas[1].enabled, false);
    assert.equal(l.raiz, false);
    assert.match(sin, /<positionX>0<\/positionX><positionY>1000<\/positionY>/);
    assert.deepEqual(diferencias([{ id: 2, borrar: true }], l.reglas), []);
});

test("en una cámara que usa (0,0) como vacío, borrar usa (0,0)", () => {
    const sin = aplicarCambios(xml("cerco-LineDetection"), "linea", [{ id: 1, borrar: true }]);
    const l = leerReglas(sin, "linea");
    assert.equal(l.reglas[0].vacia, true);
    assert.match(sin, /<positionX>0<\/positionX><positionY>0<\/positionY>/);
});

test("zona nueva en un lugar sin coordenadas, y borrarla las saca", () => {
    const pts = [{ x: 100, y: 100 }, { x: 900, y: 100 }, { x: 900, y: 900 }, { x: 100, y: 900 }, { x: 500, y: 950 }];
    const con = aplicarCambios(xml("depo-FieldDetection"), "zona", [{ id: 2, points: pts, tiempo: 3, objetivo: "human,vehicle" }]);
    const z = leerReglas(con, "zona");
    assert.equal(z.raiz, true);
    assert.equal(z.reglas[1].enabled, true);
    assert.equal(z.reglas[1].points.length, 5);
    assert.equal(z.reglas[1].tiempo, 3);
    assert.equal(z.reglas[1].objetivo, "human,vehicle");
    // La coordenada va antes de detectionTarget, como la manda la cámara.
    assert.match(con, /<\/RegionCoordinatesList><detectionTarget>human,vehicle/);
    const sin = aplicarCambios(con, "zona", [{ id: 2, borrar: true }]);
    const z2 = leerReglas(sin, "zona");
    assert.equal(z2.reglas[1].vacia, true);
    assert.equal(z2.raiz, false);
    assert.equal((sin.match(/<RegionCoordinatesList>/g) || []).length, 0);
});

test("activa:false apaga todas las líneas sin borrarlas; un cambio de ajuste no la vuelve a prender", () => {
    const con = aplicarCambios(xml("depo-LineDetection"), "linea", [{ id: 1, points: [{ x: 1, y: 2 }, { x: 300, y: 400 }] }]);
    assert.equal(leerReglas(con, "linea").raiz, true, "dibujar prende la raíz");
    const off = aplicarCambios(con, "linea", [], { activa: false });
    const l = leerReglas(off, "linea");
    assert.equal(l.raiz, false);
    assert.equal(l.reglas[0].vacia, false);
    assert.equal(l.reglas[0].enabled, false);
    const ajuste = aplicarCambios(off, "linea", [{ id: 1, sensibilidad: 30 }]);
    assert.equal(leerReglas(ajuste, "linea").raiz, false, "cambiar la sensibilidad no prende lo que se apagó");
});

test("validación: línea de un punto, zona de 2 o de 11 vértices, lugar inexistente", () => {
    assert.match(validarCambios("linea", [{ id: 1, points: [{ x: 1, y: 1 }] }], 4)!, /2 puntos/);
    assert.match(validarCambios("linea", [{ id: 1, points: [{ x: 1, y: 1 }, { x: 1, y: 1 }] }], 4)!, /2 puntos/);
    assert.match(validarCambios("zona", [{ id: 1, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }], 4)!, /vértices/);
    assert.match(validarCambios("zona", [{ id: 1, points: Array.from({ length: 11 }, (_, i) => ({ x: i, y: i })) }], 4)!, /vértices/);
    assert.match(validarCambios("zona", [{ id: 5, borrar: true }], 4)!, /4 lugares/);
    assert.equal(validarCambios("zona", [{ id: 4, borrar: true }], 4), null);
});

test("diferencias: avisa si la cámara no guardó lo pedido", () => {
    const l = leerReglas(xml("depo-LineDetection"), "linea");
    const d = diferencias([{ id: 1, points: [{ x: 1, y: 2 }, { x: 300, y: 400 }] }], l.reglas);
    assert.equal(d.length, 1);
    assert.match(d[0], /no guardó/);
});
