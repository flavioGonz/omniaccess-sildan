import test from "node:test";
import assert from "node:assert/strict";
import { armarMenu, hojasDe, type ContextoMenu } from "@/lib/menu";
import { alternarFijado, FIJADOS_DE_FABRICA, FIJADOS_MAX, hojasFijadas, leerFijados } from "@/lib/menu-fijados";

const contexto = (cambios: Partial<ContextoMenu> = {}): ContextoMenu => ({
    modos: { lpr: true, rostro: false, filas: false, guardia: true },
    func: { intrusion: true, recepcion: true, amarilla: true, censo: true, plazas: true },
    hay: { accesos: true, gps: true }, cuentas: { negra: 0, amarilla: 0, censo: 0 },
    puede: () => true, tiene: () => true, omnivision: [{ href: "/admin/vision/reglas", rotulo: "Reglas" }], ...cambios,
});
const barrio = armarMenu(contexto());
const rotulos = (fijados: string[], menu = barrio) => hojasFijadas(menu, fijados).map((h) => h.rotulo);

test("de fábrica, arriba de todo está el Monitor LPR", () => {
    assert.deepEqual(FIJADOS_DE_FABRICA, ["lpr-monitor"]);
    assert.deepEqual(rotulos(leerFijados(null)), ["Monitor LPR"]);
    assert.deepEqual(leerFijados(undefined), FIJADOS_DE_FABRICA); assert.deepEqual(leerFijados(""), FIJADOS_DE_FABRICA);
});

test("el Monitor LPR está también donde además hay rostro: si no, no habría qué fijar", () => {
    const losDos = armarMenu(contexto({ modos: { lpr: true, rostro: true, filas: false, guardia: true } }));
    const ids = hojasDe(losDos).map((h) => h.id);
    assert.ok(ids.includes("lpr-monitor")); assert.ok(ids.includes("rostro-monitor"));
    assert.deepEqual(rotulos(FIJADOS_DE_FABRICA, losDos), ["Monitor LPR"]);
});

test("fijar agrega al final, soltar saca, y el orden es el orden en que se fijó", () => {
    let f = leerFijados(null);
    f = alternarFijado(f, "gps-comandos"); f = alternarFijado(f, "mapa");
    assert.deepEqual(f, ["lpr-monitor", "gps-comandos", "mapa"]);
    assert.deepEqual(rotulos(f), ["Monitor LPR", "Comandos", "Mapa"]);
    f = alternarFijado(f, "lpr-monitor");
    assert.deepEqual(f, ["gps-comandos", "mapa"]);
    // Una pantalla de adentro de un módulo trae de qué módulo es: «Comandos» solo no dice de qué.
    assert.equal(hojasFijadas(barrio, f)[0].rotuloGrupo, "Rastreo GPS"); assert.equal(hojasFijadas(barrio, f)[1].rotuloGrupo, null);
});

test("sacar todos se respeta: una lista vacía no vuelve a los de fábrica", () => {
    const vacia = alternarFijado(leerFijados(null), "lpr-monitor");
    assert.deepEqual(vacia, []);
    assert.deepEqual(leerFijados(JSON.stringify(vacia)), []);
    assert.deepEqual(rotulos(leerFijados("[]")), []);
});

test("lo que este menú no tiene no se dibuja ni se pierde", () => {
    const guardado = ["lpr-monitor", "gps-comandos", "config-ajustes"];
    const sinGps = armarMenu(contexto({ hay: { accesos: true, gps: false } }));
    assert.deepEqual(rotulos(guardado, sinGps), ["Monitor LPR", "Ajustes"]);
    // Una instalación sólo de rostro no tiene Monitor LPR: no aparece, y no rompe.
    const rostro = armarMenu(contexto({ modos: { lpr: false, rostro: true, filas: false, guardia: false } }));
    assert.ok(!rotulos(guardado, rostro).includes("Monitor LPR"));
    // Un rol que no puede abrir Ajustes no lo ve fijado, aunque lo haya fijado otro en este navegador.
    const auditor = armarMenu(contexto({ puede: (r) => r !== "/admin/settings" }));
    assert.deepEqual(rotulos(guardado, auditor), ["Monitor LPR", "Comandos"]);
    // Y la lista guardada sigue entera: al volver el GPS, vuelve fijado.
    assert.deepEqual(rotulos(guardado), ["Monitor LPR", "Comandos", "Ajustes"]);
});

test("hay un tope, y lo guardado roto o raro no rompe", () => {
    let f: string[] = [];
    for (const h of hojasDe(barrio)) f = alternarFijado(f, h.id);
    assert.equal(f.length, FIJADOS_MAX);
    for (const crudo of ["{", "7", "\"x\"", "{\"a\":1}", "null"]) assert.deepEqual(leerFijados(crudo), FIJADOS_DE_FABRICA, crudo);
    assert.deepEqual(leerFijados(JSON.stringify(["mapa", 7, null, "", "mapa", "tags"])), ["mapa", "tags"]);
    assert.equal(leerFijados(JSON.stringify(Array.from({ length: 30 }, (_, i) => `x${i}`))).length, FIJADOS_MAX);
});
