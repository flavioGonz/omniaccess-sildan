import { test } from "node:test";
import assert from "node:assert/strict";
import { capasDelCanal, estadoDeZona, hayCapas } from "@/lib/capas-canal";

const CUADRADO = [[0.1, 0.1], [0.5, 0.1], [0.5, 0.6], [0.1, 0.6]];
const zona = (mas: object = {}) => ({ id: "z1", nombre: "Vigía", deviceId: "cam", zona: CUADRADO, positivo: "Desbordado", negativo: "Normal", activa: true, estado: null, ...mas });

test("sólo las reglas de ESE canal, y sólo las que tienen algo que dibujar", () => {
    const reglas = JSON.stringify([
        { id: "a", tipo: "intrusion", deviceId: "cam", nombre: "Portón", activa: true, zona: CUADRADO },
        { id: "b", tipo: "conteo", deviceId: "cam", nombre: "Entrada", activa: false, linea: { a: [0.2, 0.5], b: [0.8, 0.5] } },
        { id: "c", tipo: "aglomeracion", deviceId: "cam", nombre: "Todo el cuadro", activa: true, zona: null },
        { id: "d", tipo: "intrusion", deviceId: "otra", nombre: "Ajena", activa: true, zona: CUADRADO },
    ]);
    const c = capasDelCanal("cam", { reglas, zonas: [], equipo: null });
    assert.deepEqual(c.reglas.map((r) => r.id), ["a", "b"]);
    assert.equal(c.reglas[0].tipo, "Intrusión en zona propia");
    assert.equal(c.reglas[1].activa, false);
    assert.deepEqual(c.reglas[1].linea, [[0.2, 0.5], [0.8, 0.5]]);
    assert.equal(c.reglas[1].zona, null);
});

test("un ajuste roto o vacío no rompe: no hay reglas", () => {
    for (const reglas of [null, "", "{", "{}", 7]) assert.deepEqual(capasDelCanal("cam", { reglas, zonas: [], equipo: null }).reglas, []);
});

test("la entrenable avisa por el estado del worker (histéresis), no por comparar con el umbral", () => {
    // 0,50 está debajo de un umbral de 0,60, pero el worker todavía no salió del estado que avisa.
    const c = capasDelCanal("cam", { reglas: null, zonas: [zona({ estado: { prob: 0.5, al: "2026-11-15T12:00:00.000Z", positivoDesde: "2026-11-15T11:00:00.000Z" } }), zona({ id: "z2", deviceId: "otra" }), zona({ id: "z3", zona: [[0, 0]] })], equipo: null });
    assert.deepEqual(c.entrenables.map((z) => z.id), ["z1"]);
    assert.equal(c.entrenables[0].avisa, true);
    assert.equal(c.entrenables[0].prob, 0.5);
    assert.deepEqual(estadoDeZona(null), { prob: null, al: null, avisa: false });
    assert.equal(estadoDeZona({ prob: 0.9, positivoDesde: null }).avisa, false);
});

test("la lectura: el rectángulo pasa a cuatro esquinas y la línea a dos puntos, sólo en una cámara que lee", () => {
    const equipo = { deviceType: "LPR_INTERIOR", trackEnabled: true, trackRoi: JSON.stringify({ x: 0.2, y: 0.3, w: 0.5, h: 0.9 }), trackLine: JSON.stringify({ x1: 0.1, y1: 0.8, x2: 0.9, y2: 0.7 }) };
    const c = capasDelCanal("cam", { reglas: null, zonas: [], equipo });
    assert.deepEqual(c.lectura?.zona, [[0.2, 0.3], [0.7, 0.3], [0.7, 1], [0.2, 1]]);
    assert.deepEqual(c.lectura?.linea, [[0.1, 0.8], [0.9, 0.7]]);
    assert.equal(capasDelCanal("cam", { reglas: null, zonas: [], equipo: { ...equipo, trackEnabled: false } }).lectura, null);
    assert.equal(capasDelCanal("cam", { reglas: null, zonas: [], equipo: { ...equipo, deviceType: "CAMERA" } }).lectura, null);
    assert.equal(capasDelCanal("cam", { reglas: null, zonas: [], equipo: { ...equipo, trackRoi: null, trackLine: "x" } }).lectura, null);
});

test("sin nada dibujado no hay capas", () => {
    assert.equal(hayCapas(capasDelCanal("cam", { reglas: null, zonas: [], equipo: null })), false);
    assert.equal(hayCapas(capasDelCanal("cam", { reglas: null, zonas: [zona()], equipo: null })), true);
    assert.equal(hayCapas(null), false);
});

test("los rótulos de figuras encimadas no se escriben uno arriba del otro", async () => {
    const { ubicarRotulos } = await import("@/components/monitor/camaras/CapasDeAnaliticas");
    // Tres zonas casi iguales sobre el mismo contenedor, abajo a la izquierda (la captura del 15/11).
    const z = (d: number): [number, number][] => [[0 + d, 0.6 + d], [0.25 + d, 0.6 + d], [0.25 + d, 1 - d], [0 + d, 1 - d]];
    const r = ubicarRotulos([{ clave: "a", texto: "Vigia Contenedor 01 · Desbordado 68 %", figura: z(0) }, { clave: "b", texto: "Deteccion de Contenedores", figura: z(0.01) }, { clave: "c", texto: "Basura en el piso", figura: z(0.02) }], 1600, 900);
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) assert.ok(Math.abs(r[i].y - r[j].y) >= 24, `${r[i].clave} y ${r[j].clave} en el mismo renglón`);
    assert.ok(r.every((x) => x.y >= 25 && x.y <= 894 && x.x >= 8));
});
