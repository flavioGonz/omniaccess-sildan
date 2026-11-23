import test from "node:test";
import assert from "node:assert/strict";
import { armarMenu, hojasDe, type ContextoMenu } from "@/lib/menu";
import { buscarPantallas, sinTildes, TAMBIEN_SE_DICE } from "@/lib/menu-buscar";

const OMNIVISION = [{ href: "/admin/vision/analiticas", rotulo: "Analíticas" }, { href: "/admin/vision/reglas", rotulo: "Reglas" }, { href: "/admin/vision/detecciones", rotulo: "Detecciones" }];
const contexto = (cambios: Partial<ContextoMenu> = {}): ContextoMenu => ({
    modos: { lpr: true, rostro: false, filas: false, guardia: true },
    func: { intrusion: true, recepcion: true, amarilla: true, censo: true, plazas: true },
    hay: { accesos: true, gps: true }, cuentas: { negra: 0, amarilla: 0, censo: 0 },
    puede: () => true, tiene: () => true, omnivision: OMNIVISION, ...cambios,
});
const barrio = hojasDe(armarMenu(contexto()));
const rotulos = (texto: string, hojas = barrio) => buscarPantallas(hojas, texto).map((h) => h.rotulo);
const ids = (texto: string, hojas = barrio) => buscarPantallas(hojas, texto).map((h) => h.id);

test("sin tildes ni mayúsculas, y con los espacios de más afuera", () => {
    assert.equal(sinTildes("  Matrículas   REQUERIDAS "), "matriculas requeridas");
    assert.deepEqual(rotulos("MATRICULA"), rotulos("matrícula"));
    assert.ok(rotulos("matricula").includes("Vehículos y matrículas"));
});

test("sin texto devuelve todas las pantallas, en el orden del menú", () => {
    assert.equal(buscarPantallas(barrio, "").length, barrio.length);
    assert.equal(buscarPantallas(barrio, "   ")[0].id, barrio[0].id);
});

test("el nombre de la pantalla gana sobre el del módulo, y el módulo sobre un sinónimo", () => {
    // «mapa» es una pantalla; no tiene que quedar detrás de algo que sólo lo nombra de costado.
    assert.equal(ids("mapa")[0], "mapa");
    // «residentes» es el nombre; «usuarios» es cómo le dicen: lo encuentra igual, y primero.
    assert.equal(ids("residentes")[0], "personas-residentes");
    assert.equal(ids("usuarios")[0], "personas-residentes");
    assert.ok(ids("usuarios").includes("config-ajustes"), "los usuarios del panel están en Ajustes");
    // «reportes»: el nombre de una pantalla va antes que las que lo traen como sinónimo.
    assert.equal(ids("reportes")[0], "gps-reportes");
});

test("el nombre del módulo trae todas sus pantallas, en su orden", () => {
    assert.deepEqual(ids("gps").slice(0, 5), ["gps-vehiculos", "gps-zonas", "gps-reportes", "gps-comandos", "gps-ajustes"]);
    assert.deepEqual(rotulos("guardia").slice(0, 4), ["Consola de guardia", "Bitácora", "Visitas y proveedores", "Puestos y consolas"]);
});

test("todas las palabras tienen que estar: «gps comandos» es una sola pantalla", () => {
    assert.deepEqual(ids("gps comandos"), ["gps-comandos"]);
    assert.deepEqual(ids("comandos gps"), ["gps-comandos"]);
    assert.deepEqual(ids("lista negra"), ["lista-negra"]);
});

test("como le dice la gente: cámaras, chapas, flota, tarjetas", () => {
    assert.ok(ids("camaras").includes("video-cctv"));
    assert.ok(ids("camaras").includes("equipos-lista"));
    assert.equal(ids("chapas")[0], "historial-lecturas");
    assert.ok(ids("patentes").includes("lpr-vehiculos"));
    assert.ok(ids("flota").every((id) => id.startsWith("gps-")));
    assert.deepEqual(ids("tarjetas"), ["tags"]);
    assert.deepEqual(ids("cortar motor"), ["gps-comandos"]);
});

test("dos letras no traen lo que las tiene en el medio de una palabra", () => {
    const re = rotulos("re", buscarPantallas(barrio, ""));
    assert.equal(re[0], "Reportes");
    assert.ok(!re.includes("Pared de monitores"), "«pa-re-d» no es lo que se busca");
    assert.ok(!re.includes("Zonas"), "ni el «rast-re-o» del módulo");
    // Con tres ya vale en el medio del nombre: «tric» encuentra matrículas.
    assert.ok(rotulos("tric").includes("Vehículos y matrículas"));
});

test("lo que no existe no devuelve nada, y no se cuelga con símbolos", () => {
    assert.deepEqual(ids("zzzz"), []);
    for (const raro of ["(", "[a-", "\\", "*", "?¿", "<script>"]) assert.ok(Array.isArray(ids(raro)), raro);
});

test("no trae más de las que entran a la vista", () => {
    assert.ok(buscarPantallas(barrio, "a").length <= 8);
    assert.equal(buscarPantallas(barrio, "a", 3).length, 3);
});

test("lo que el rol no ve en el menú tampoco sale en el buscador", () => {
    const auditor = hojasDe(armarMenu(contexto({ puede: (r) => r === "/admin/audit" || r === "/admin/history", tiene: () => false })));
    assert.deepEqual(ids("ajustes", auditor), []);
    assert.deepEqual(ids("gps", auditor), []);
    assert.deepEqual(ids("auditoria", auditor), ["config-auditoria"]);
    // Y sin GPS en la instalación, «flota» no encuentra nada.
    const sinGps = hojasDe(armarMenu(contexto({ hay: { accesos: true, gps: false } })));
    assert.deepEqual(ids("flota", sinGps), []);
});

test("cada sinónimo cuelga de una pantalla que existe", () => {
    const todas = new Set([
        ...barrio,
        ...hojasDe(armarMenu(contexto({ modos: { lpr: false, rostro: true, filas: false, guardia: true } }))),
        ...hojasDe(armarMenu(contexto({ modos: { lpr: false, rostro: false, filas: true, guardia: false } }))),
    ].map((h) => h.id));
    for (const id of Object.keys(TAMBIEN_SE_DICE)) assert.ok(todas.has(id), `«${id}» tiene sinónimos pero no está en el menú`);
});
