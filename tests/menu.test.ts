import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { activoDe, armarMenu, hojasDe, insigniaDeGrupo, type ContextoMenu, type SeccionMenu } from "@/lib/menu";

const OMNIVISION = [{ href: "/admin/vision/analiticas", rotulo: "Analíticas" }, { href: "/admin/vision/reglas", rotulo: "Reglas" }, { href: "/admin/vision/detecciones", rotulo: "Detecciones" }];
/** Un barrio como San Nicolás: matrículas y guardia, con todo prendido y un administrador. */
const barrio = (cambios: Partial<ContextoMenu> = {}): ContextoMenu => ({
    modos: { lpr: true, rostro: false, filas: false, guardia: true },
    func: { intrusion: true, recepcion: true, amarilla: true, censo: true, plazas: true },
    hay: { accesos: true, gps: true }, cuentas: { negra: 3, amarilla: 1, censo: 7 },
    puede: () => true, tiene: () => true, omnivision: OMNIVISION, ...cambios,
});
const rotulos = (menu: SeccionMenu[], seccion: string) => (menu.find((s) => s.id === seccion)?.entradas || []).map((e) => e.rotulo);
const hijos = (menu: SeccionMenu[], id: string) => { const e = menu.flatMap((s) => s.entradas).find((x) => x.id === id); return e?.hijos ? e.hijos.map((h) => h.rotulo) : null; };

test("un barrio completo: cuatro secciones, lo común arriba y el historial ahí", () => {
    const m = armarMenu(barrio());
    assert.deepEqual(m.map((s) => s.titulo), [null, "Módulos", "Padrón", "Sistema"]);
    assert.deepEqual(rotulos(m, "comun"), ["Gestión de alarmas", "Mapa", "Historial", "Evidencias"]);
    assert.deepEqual(hijos(m, "historial"), ["Accesos", "Lecturas de cámara"]);
    /* Con porteros, el Monitor Face está aunque no esté el modo face (el portero cuenta sus caras). */
    assert.deepEqual(rotulos(m, "modulos"), ["Matrículas", "Monitor Face", "Intrusión", "Video", "Rastreo GPS", "Guardia", "OmniVision"]);
    assert.deepEqual(rotulos(m, "padron"), ["Personas", "Unidades", "Tags RFID", "Grupos de acceso", "Calendario"]);
    assert.deepEqual(rotulos(m, "sistema"), ["Dispositivos", "Configuración"]);
});

test("pasa de una lista de treinta entradas a menos de veinte a la vista", () => {
    const m = armarMenu(barrio());
    const primerNivel = m.reduce((a, s) => a + s.entradas.length, 0);
    assert.ok(primerNivel <= 18, `hay ${primerNivel} entradas de primer nivel`);
    assert.ok(hojasDe(m).length >= 35, "no se perdió ninguna pantalla por agruparlas");
});

test("las listas de vigilancia van dentro de Matrículas, y Pared de monitores en Video", () => {
    const m = armarMenu(barrio());
    assert.deepEqual(hijos(m, "matriculas"), ["Monitor LPR", "Vehículos y matrículas", "Lista negra", "Lista amarilla", "Invitados", "Plazas de parking"]);
    assert.deepEqual(hijos(m, "video"), ["Monitor CCTV", "Pared de monitores"]);
    assert.deepEqual(hijos(m, "gps"), ["Vehículos", "Zonas", "Reportes", "Comandos", "Ajustes"]);
    assert.deepEqual(hijos(m, "personas"), ["Residentes", "Censo"]);
});

test("cada entrada lleva a una pantalla que existe", () => {
    const todas = [barrio(), barrio({ modos: { lpr: false, rostro: true, filas: false, guardia: false } }), barrio({ modos: { lpr: false, rostro: false, filas: true, guardia: false } })]
        .flatMap((c) => hojasDe(armarMenu({ ...c, omnivision: [...OMNIVISION, { href: "/admin/vision/buscar", rotulo: "Buscar" }, { href: "/admin/vision/relecturas", rotulo: "Relecturas" }, { href: "/admin/vision/verificacion", rotulo: "Verificación" }] })));
    const rutas = [...new Set(todas.map((h) => h.href.split("?")[0]))];
    assert.ok(rutas.length > 30);
    for (const r of rutas) assert.ok(fs.existsSync(path.join(__dirname, "..", "src", "app", r, "page.tsx")), `no existe la pantalla ${r}`);
});

test("ningún id se repite: el menú los usa para saber qué está abierto y qué está activo", () => {
    for (const c of [barrio(), barrio({ modos: { lpr: false, rostro: true, filas: false, guardia: false } })]) {
        const m = armarMenu(c), ids = [...hojasDe(m).map((h) => h.id), ...m.flatMap((s) => s.entradas.filter((e) => e.hijos).map((e) => e.id))];
        assert.equal(new Set(ids).size, ids.length, "ids repetidos: " + ids.filter((x, i) => ids.indexOf(x) !== i).join(", "));
    }
});

test("lo que la instalación no tiene no aparece", () => {
    const m = armarMenu(barrio({ func: { intrusion: false, recepcion: false, amarilla: false, censo: false, plazas: false }, hay: { accesos: false, gps: false } }));
    assert.deepEqual(rotulos(m, "modulos"), ["Matrículas", "Video", "Guardia", "OmniVision"]);
    assert.deepEqual(hijos(m, "matriculas"), ["Monitor LPR", "Vehículos y matrículas", "Lista negra", "Invitados"]);
    /* Sin censo, Personas queda con una sola pantalla y deja de ser un grupo. */
    const personas = m.flatMap((s) => s.entradas).find((e) => e.rotulo === "Personas")!;
    assert.equal(personas.hijos, undefined); assert.equal(personas.href, "/admin/users");
    /* Sin porteros, Dispositivos lleva derecho a los equipos. */
    assert.equal(m.flatMap((s) => s.entradas).find((e) => e.rotulo === "Dispositivos")!.href, "/admin/devices");
});

test("un grupo con una sola pantalla es una entrada directa, con el nombre que mejor la dice", () => {
    const soloPared = armarMenu(barrio({ puede: (r) => r !== "/admin/monitor-cctv" }));
    const video = soloPared.flatMap((s) => s.entradas).find((e) => e.icono === "video")!;
    assert.equal(video.rotulo, "Pared de monitores"); assert.equal(video.href, "/admin/monitores");
    /* Un auditor: de Configuración sólo ve la auditoría, y así se llama su entrada. */
    const auditor = armarMenu(barrio({ puede: (r) => r === "/admin/audit" || r === "/admin/history", tiene: () => false }));
    assert.deepEqual(auditor.map((s) => s.entradas.map((e) => e.rotulo)), [["Historial"], ["Auditoría"]]);
});

test("el rol manda: lo que no puede abrir no está, y una sección vacía tampoco", () => {
    const flota = armarMenu(barrio({ puede: (r) => r === "/admin/gps" || r === "/admin/mapa", tiene: () => false }));
    assert.deepEqual(flota.map((s) => s.titulo), [null, "Módulos"]);
    assert.deepEqual(rotulos(flota, "comun"), ["Mapa"]);
    assert.deepEqual(rotulos(flota, "modulos"), ["Rastreo GPS"]);
    assert.equal(armarMenu(barrio({ puede: () => false, tiene: () => false })).length, 0);
});

test("la consola de guardia pide el permiso de guardia, no una ruta del panel", () => {
    assert.ok(hijos(armarMenu(barrio()), "guardia")!.includes("Consola de guardia"));
    assert.ok(!hijos(armarMenu(barrio({ tiene: () => false })), "guardia")!.includes("Consola de guardia"));
});

test("una instalación de rostro: su monitor, y las listas quedan con las personas", () => {
    const m = armarMenu(barrio({ modos: { lpr: false, rostro: true, filas: false, guardia: false } }));
    assert.deepEqual(rotulos(m, "modulos"), ["Rostro", "Intrusión", "Video", "Rastreo GPS", "OmniVision"]);
    assert.deepEqual(hijos(m, "rostro"), ["Monitor Face", "En vivo: entrada y salida"]);
    assert.deepEqual(hijos(m, "personas"), ["Residentes", "Lista negra", "Lista amarilla", "Censo"]);
    assert.equal(m.flatMap((s) => s.entradas).find((e) => e.rotulo === "Historial")!.href, "/admin/history");
});

test("una instalación de filas conserva todo lo que tenía, agrupado en su módulo", () => {
    const m = armarMenu(barrio({ modos: { lpr: false, rostro: false, filas: true, guardia: false }, func: { intrusion: false, recepcion: false, amarilla: false, censo: false, plazas: false }, hay: { accesos: false, gps: false } }));
    assert.deepEqual(m.map((s) => s.titulo), [null, "Módulos", "Sistema"]);
    assert.deepEqual(rotulos(m, "comun"), ["Mapas", "Evidencias"]);
    assert.deepEqual(hijos(m, "filas"), ["Monitor en vivo", "Flujo de filas", "Filas", "Despachos", "Reportes", "Horarios", "Pantalla y kiosko", "Calibración"]);
    assert.ok(rotulos(m, "modulos").includes("Pared de monitores"));
    assert.deepEqual(rotulos(m, "sistema"), ["Configuración"]);
});

test("qué entrada se marca: gana la que nombra la pestaña", () => {
    const m = armarMenu(barrio());
    const en = (ruta: string, q = "") => activoDe(m, ruta, q);
    assert.deepEqual(en("/admin/users"), { id: "personas-residentes", grupo: "personas" });
    assert.deepEqual(en("/admin/users", "tab=listanegra"), { id: "lista-negra", grupo: "matriculas" });
    assert.deepEqual(en("/admin/users", "tab=otra"), { id: "personas-residentes", grupo: "personas" });
    assert.deepEqual(en("/admin/gps"), { id: "gps-vehiculos", grupo: "gps" });
    assert.deepEqual(en("/admin/gps", "t=comandos&v=860000000000001"), { id: "gps-comandos", grupo: "gps" });
    assert.deepEqual(en("/admin/alarmas"), { id: "alarmas", grupo: null });
});

test("qué entrada se marca: las pantallas que cuelgan de otra y las rutas hermanas", () => {
    const m = armarMenu(barrio());
    /* Dispositivos quedó con una sola pantalla (el Monitor Face se fue a Rostro): es una entrada suelta. */
    assert.deepEqual(activoDe(m, "/admin/devices/abc", ""), { id: "equipos-lista", grupo: null });
    assert.deepEqual(activoDe(m, "/admin/face", ""), { id: "rostro-capturas", grupo: null });
    assert.deepEqual(activoDe(m, "/admin/credentials", ""), { id: "lpr-vehiculos", grupo: "matriculas" });
    assert.deepEqual(activoDe(m, "/admin/vision/analiticas/estacionamiento", ""), { id: "vision-analiticas", grupo: "vision" });
    assert.equal(activoDe(m, "/admin/changelog", ""), null);
    /* Un parecido de nombre no alcanza: /admin/mapas no es /admin/mapa. */
    assert.equal(activoDe(m, "/admin/mapas", ""), null);
});

test("un grupo cerrado muestra la suma de lo que tiene pendiente adentro", () => {
    const m = armarMenu(barrio());
    const matriculas = m.flatMap((s) => s.entradas).find((e) => e.id === "matriculas")!;
    assert.deepEqual(insigniaDeGrupo(matriculas.hijos!), { n: 4, tono: "mal" });
    const personas = m.flatMap((s) => s.entradas).find((e) => e.id === "personas")!;
    assert.deepEqual(insigniaDeGrupo(personas.hijos!), { n: 7, tono: "aviso" });
    assert.equal(insigniaDeGrupo(armarMenu(barrio({ cuentas: { negra: 0, amarilla: 0, censo: 0 } })).flatMap((s) => s.entradas).find((e) => e.id === "matriculas")!.hijos!), undefined);
});
