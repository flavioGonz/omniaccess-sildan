import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { claseDePantalla, estadoDelMenu, guardarMenuElegido, leerMenuElegido, MENU_DE_FABRICA } from "@/lib/menu-estado";

test("los monitores, la pared y los mapas son de mirar; lo demás, de gestión", () => {
    for (const r of ["/admin/monitor-lpr", "/admin/monitor-cctv", "/admin/monitor-face", "/admin/monitor-intrusion", "/admin/monitor-queue", "/admin/monitores", "/admin/mapa", "/admin/mapas"]) assert.equal(claseDePantalla(r), "mirar", r);
    for (const r of ["/admin/users", "/admin/history", "/admin/gps", "/admin/settings", "/admin/alarmas", "/admin/devices", "/admin/evidencias", "/admin", ""]) assert.equal(claseDePantalla(r), "gestion", r);
});

test("la clase no se confunde con una ruta que empieza igual, ni con la consulta o la barra final", () => {
    assert.equal(claseDePantalla("/admin/mapa?gps=1&zona=nueva"), "mirar");
    assert.equal(claseDePantalla("/admin/mapa/"), "mirar");
    assert.equal(claseDePantalla("/admin/monitores/pared-2"), "mirar");
    // «/admin/mapache» no es el mapa: se compara por tramo entero.
    assert.equal(claseDePantalla("/admin/mapache"), "gestion");
});

test("toda pantalla de mirar existe: una ruta renombrada no queda en la lista sin que se note", () => {
    const fuente = fs.readFileSync(path.join(process.cwd(), "src/lib/menu-estado.ts"), "utf8");
    const rutas = [...fuente.matchAll(/"(\/admin\/[a-z-]+)"/g)].map((m) => m[1]);
    assert.ok(rutas.length >= 8);
    for (const r of rutas) assert.ok(fs.existsSync(path.join(process.cwd(), "src/app", r, "page.tsx")), `${r} no tiene pantalla`);
});

test("de fábrica: a la vista en gestión, oculto en las de mirar", () => {
    assert.deepEqual(MENU_DE_FABRICA, { gestion: "vista", mirar: "oculto" });
    assert.equal(estadoDelMenu({}, "/admin/users", false), "vista");
    assert.equal(estadoDelMenu({}, "/admin/monitor-cctv", false), "oculto");
});

test("lo que se elige vale para su clase de pantalla y no toca la otra", () => {
    const crudo = guardarMenuElegido({}, "mirar", "vista");
    const e = leerMenuElegido(crudo);
    assert.equal(estadoDelMenu(e, "/admin/mapa", false), "vista");
    assert.equal(estadoDelMenu(e, "/admin/monitor-lpr", false), "vista");
    assert.equal(estadoDelMenu(e, "/admin/users", false), "vista");
    const e2 = leerMenuElegido(guardarMenuElegido(e, "gestion", "iconos"));
    assert.equal(estadoDelMenu(e2, "/admin/users", false), "iconos");
    assert.equal(estadoDelMenu(e2, "/admin/mapa", false), "vista");
});

test("en un celular siempre flota, y la elección del escritorio queda guardada", () => {
    const e = leerMenuElegido(guardarMenuElegido({}, "gestion", "iconos"));
    assert.equal(estadoDelMenu(e, "/admin/users", true), "oculto");
    assert.equal(estadoDelMenu(e, "/admin/users", false), "iconos");
});

test("quien lo tenía clavado con la clave vieja lo conserva a la vista en todos lados", () => {
    const e = leerMenuElegido(null, "fijo");
    assert.equal(estadoDelMenu(e, "/admin/monitor-cctv", false), "vista");
    assert.equal(estadoDelMenu(e, "/admin/users", false), "vista");
    // Y lo nuevo que elija pisa lo viejo.
    const e2 = leerMenuElegido(guardarMenuElegido(e, "mirar", "oculto"), "fijo");
    assert.equal(estadoDelMenu(e2, "/admin/monitor-cctv", false), "oculto");
});

test("el «oculto» de la clave vieja no se trae: era el estado de fábrica, no una elección", () => {
    assert.deepEqual(leerMenuElegido(null, "oculto"), {});
    assert.equal(estadoDelMenu(leerMenuElegido(null, "oculto"), "/admin/users", false), "vista");
});

test("un guardado roto o con valores que no existen no rompe: vale lo de fábrica", () => {
    for (const crudo of ["{", "null", "7", "\"vista\"", "[]", JSON.stringify({ gestion: "enorme", mirar: 3 })]) {
        const e = leerMenuElegido(crudo);
        assert.equal(estadoDelMenu(e, "/admin/users", false), "vista", crudo);
        assert.equal(estadoDelMenu(e, "/admin/mapa", false), "oculto", crudo);
    }
    // Una clave buena al lado de una mala: se queda con la buena.
    assert.deepEqual(leerMenuElegido(JSON.stringify({ gestion: "iconos", mirar: "x" })), { gestion: "iconos" });
});
