/** Usuarios › Proveedores: los del barrio, los de las administraciones y los de cada lote, en una lista (28/11). */
import test from "node:test";
import assert from "node:assert/strict";
import { contarProveedores, deAdministracion, deLote, delPadron, filtrarProveedores, reunirProveedores, type ServicioDeAdmCrudo, type ServicioDeLoteCrudo } from "@/lib/proveedores-reunidos";

const lote = (id: string, nombre: string, extra: Partial<ServicioDeLoteCrudo> = {}): ServicioDeLoteCrudo => ({
    id, tipo: "JARDINERO", nombre: "Verde Sur", telefono: null, documento: null, chapa: null, dias: ["mar", "vie"], desde: "08:00", hasta: "12:00",
    notas: null, estado: "ACTIVO", origen: "panel", autorizado: false, lote: { id: `u-${nombre}`, nombre, etapa: "6ª" }, ...extra,
});
const adm = (id: string, extra: Partial<ServicioDeAdmCrudo> = {}): ServicioDeAdmCrudo => ({
    id, rubro: "Recolección de residuos", proveedor: "Limpia SA", contacto: "Marta", telefono: "099 000 111", email: null, horario: "Lunes y jueves, de 8 a 12", notas: null,
    administracion: { id: "a1", nombre: "Etapas 4 y 5", sigla: "4-5" }, ...extra,
});

test("proveedores reunidos: un servicio de lote dice a qué lote viene y qué pasa en el portón", () => {
    const f = deLote(lote("s1", "A 12 (6ª)", { chapa: "sba 1234", origen: "censo" }));
    assert.equal(f.origen, "lote");
    assert.deepEqual(f.de, { id: "u-A 12 (6ª)", nombre: "A 12 (6ª)" });
    assert.equal(f.rubro, "Jardinero");
    assert.equal(f.cuando, "mar y vie · 08:00 a 12:00");
    assert.deepEqual(f.chapas, ["SBA1234"], "la matrícula va limpia");
    assert.equal(f.entrada, "identifica", "sin habilitar, sólo se lo reconoce");
    assert.equal(f.declarado, "censo");
    assert.equal(deLote(lote("s2", "A 1", { autorizado: true })).entrada, "horario");
    assert.equal(deLote(lote("s3", "A 1", { autorizado: true, estado: "INACTIVO" })).entrada, "baja", "el que dejó de venir no entra, diga lo que diga la marca");
    assert.equal(deLote(lote("s4", "A 1")).declarado, null, "lo que cargó la administración no es «declarado»");
});

test("proveedores reunidos: un servicio de administración es informativo y dice de cuál es", () => {
    const f = deAdministracion(adm("x1"));
    assert.equal(f.origen, "administracion");
    assert.deepEqual(f.de, { id: "a1", nombre: "Etapas 4 y 5" });
    assert.equal(f.nombre, "Limpia SA");
    assert.equal(f.contacto, "Marta");
    assert.equal(f.entrada, "informativo");
    assert.deepEqual(f.chapas, []);
    const solo = deAdministracion(adm("x2", { proveedor: null }));
    assert.equal(solo.nombre, "Marta", "sin empresa, quién es la persona de contacto");
    assert.equal(solo.contacto, null, "y no se repite abajo");
});

test("proveedores reunidos: el del padrón entra con lo que tenga cargado", () => {
    const con = delPadron({ id: "p1", name: "Sildan", empresa: "Sildan", credentials: [{ type: "PLATE", value: "sbc-5678" }], vehicles: [{ plate: "SBC5678" }, { plate: "SBD0001" }] });
    assert.equal(con.origen, "barrio");
    assert.equal(con.de, null, "es de todo el barrio");
    assert.deepEqual(con.chapas, ["SBC5678", "SBD0001"], "credencial y vehículo, sin repetir");
    assert.equal(con.entrada, "credencial");
    assert.equal(delPadron({ id: "p2", name: "Juan", credentials: [{ type: "TAG", value: "0011" }] }).entrada, "credencial", "un tag también abre");
    assert.equal(delPadron({ id: "p3", name: "Juan" }).entrada, "sin-credencial");
    assert.equal(delPadron({ id: "p4", name: "Ana", empleador: { name: "Sildan", empresa: null } }).rubro, "Sildan", "el empleado dice para quién trabaja");
});

test("proveedores reunidos: se juntan los tres, primero el barrio, y cada grupo por nombre", () => {
    const filas = reunirProveedores(
        [{ id: "p1", name: "Zeta" }, { id: "p2", name: "alfa" }],
        [adm("x1")],
        [lote("s1", "B 2", { nombre: "Ramón" }), lote("s2", "A 1", { nombre: "" })],
    );
    assert.deepEqual(filas.map((f) => f.clave), ["barrio:p2", "barrio:p1", "adm:x1", "lote:s2", "lote:s1"], "el sin nombre se ordena por su servicio («Jardinero» antes que «Ramón»)");
});

test("proveedores reunidos: el mismo vehículo en varios lotes se dice, y sólo por la matrícula", () => {
    const filas = reunirProveedores([], [], [
        lote("s1", "A 1", { chapa: "SBA1234" }), lote("s2", "A 10", { chapa: "sba-1234" }), lote("s3", "A 2", { chapa: "SBA1234" }),
        lote("s4", "C 9", { nombre: "Verde Sur" }),
        lote("s5", "D 4", { chapa: "SBA1234", estado: "INACTIVO" }),
    ]);
    const de = (id: string) => filas.find((f) => f.id === id)!;
    assert.deepEqual(de("s1").tambienEn, ["A 2", "A 10"], "en orden de lote, el 2 antes que el 10");
    assert.deepEqual(de("s4").tambienEn, [], "el mismo nombre no alcanza: cada casa lo escribe a su manera");
    assert.ok(!de("s1").tambienEn.includes("D 4"), "donde dejó de venir no cuenta");
    assert.deepEqual(de("s5").tambienEn, ["A 1", "A 2", "A 10"], "pero la baja sí dice dónde sigue viniendo");
});

test("proveedores reunidos: se filtra por de quién es, por si sigue viniendo y por lo escrito", () => {
    const filas = reunirProveedores(
        [{ id: "p1", name: "Sildan", vehicles: [{ plate: "SBC5678" }] }],
        [adm("x1")],
        [lote("s1", "A 12 (6ª)", { nombre: "Ramón Pérez", chapa: "SBA1234" }), lote("s2", "B 3 (6ª)", { nombre: "Piscinas Sol", tipo: "PISCINERO", estado: "INACTIVO" })],
    );
    const ver = (origen: "todos" | "barrio" | "administracion" | "lote", q = "", bajas = false) => filtrarProveedores(filas, { origen, bajas, q }).map((f) => f.clave);
    assert.deepEqual(ver("todos"), ["barrio:p1", "adm:x1", "lote:s1"], "los dados de baja no se ven de entrada");
    assert.deepEqual(ver("todos", "", true), ["lote:s2"], "y se ven solos cuando se los pide");
    assert.deepEqual(ver("lote"), ["lote:s1"]);
    assert.deepEqual(ver("administracion"), ["adm:x1"]);
    assert.deepEqual(ver("todos", "a 12"), ["lote:s1"], "por el lote");
    assert.deepEqual(ver("todos", "ramon"), ["lote:s1"], "sin tildes");
    assert.deepEqual(ver("todos", "sba 12"), ["lote:s1"], "la matrícula, como se dicta");
    assert.deepEqual(ver("todos", "etapas 4"), ["adm:x1"], "por la administración");
    assert.deepEqual(ver("todos", "recolección"), ["adm:x1"], "por el servicio");
    assert.deepEqual(ver("barrio", "ramon"), [], "el filtro de origen manda sobre la búsqueda");
    assert.deepEqual(contarProveedores(filas), { todos: 3, barrio: 1, administracion: 1, lote: 1, bajas: 1 });
});
