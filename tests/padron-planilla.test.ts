import test from "node:test";
import assert from "node:assert/strict";
import { codigoDeNombreViejo, compartenNombre, leerPadron, mismoNombre, siglaDeEtapa } from "@/lib/padron-planilla";

/* Los datos de estas pruebas son inventados: la forma es la de la planilla de San Nicolás (v8),
   las personas no existen. */
const CAB_LOTES = ["Etapa", "Manzana", "Solar", "Unidad", "Lote / unidad", "Proa", "Área del solar (m²)", "Titular según administración / gastos comunes", "Contactos en las listas", "Mails", "Nº contactos", "Estado", "Observaciones"];
const CAB_ENVIOS = ["Nombre", "Mail", "Nº lotes", "Lotes y vínculo", "Vínculo general", "Observaciones"];
const lotes = [
    CAB_LOTES,
    ["Etapas 1, 2 y 3", "A", "2", null, "A 2", null, 1056.3, "Ana Ejemplo - Luis Prueba", "Ana Ejemplo", "ana@ejemplo.uy", 1, "OK: el titular tiene mail", null],
    ["Etapas 4 y 5", "A", "2", null, "A 2", null, "980,5", "Carla Muestra / Pedro Inquilino", "Pedro Inquilino", "pedro@ejemplo.uy", 1, "Contacto inquilino u ocupante", "Alquilada"],
    ["Etapas 4 y 5", "B", "6C", "b", "B 6Cb", "Proa 6", 310, "Marta Caso", "Marta Caso", "marta@ejemplo.uy", 1, "OK: el titular tiene mail", null],
    ["6ª Etapa", "C", "1", "a", "C 1a", null, 500, "Marta Caso", null, null, 0, "OK: el titular tiene mail", null],
    ["7ª Etapa (V11)", "D", "4", null, "D 4", null, 1200, "Raúl Terreno", null, null, 0, "Terreno sin construcción: no se envía código", null],
    ["Etapas 4 y 5", "D", "8", null, "D 8", null, 2530, null, null, null, 0, "Sin titular en las listas de la administración", "Tajamar"],
    ["Etapas 4 y 5", "K", "1B", null, "K 1B", null, 800, "Datylco", null, null, 0, "Desarrollador (sin vender)", null],
];
const envios = [
    CAB_ENVIOS,
    ["Ana Ejemplo", "Ana@Ejemplo.uy", 1, "A 2 (1-3) propietario", "Propietario", null],
    ["Pedro Inquilino", "pedro@ejemplo.uy", 1, "A 2 (4-5) inquilino u ocupante", "Inquilino", null],
    ["Marta Caso", "marta@ejemplo.uy", 2, "B 6Cb (4-5) propietario; C 1a (6ª) familia del propietario", "Propietario", "Dos lotes"],
    ["(sin nombre; dominio ejemplo)", "info@ejemplo.uy", 1, "A 2 (4-5) inquilino", "Inquilino", null],
    ["Sin Lote", "nadie@ejemplo.uy", 1, "Z 9 (1-3) propietario", "Propietario", null],
    ["Mal Correo", "esto no es un correo", 1, "A 2 (1-3) propietario", "Propietario", null],
];

test("la sigla de una etapa es la que la administración pone entre paréntesis", () => {
    assert.equal(siglaDeEtapa("Etapas 1, 2 y 3"), "1-3");
    assert.equal(siglaDeEtapa("Etapas 4 y 5"), "4-5");
    assert.equal(siglaDeEtapa("6ª Etapa"), "6ª");
    assert.equal(siglaDeEtapa("7ª Etapa (V11)"), "7ª");          // la versión del plano no es parte de la etapa
    // Y la forma corta se lee a sí misma, que es como viene en la hoja de envíos.
    for (const s of ["1-3", "4-5", "6ª", "7ª"]) assert.equal(siglaDeEtapa(s), s);
});

test("el mismo código en dos etapas son dos lotes distintos, cada uno con su nombre", () => {
    const p = leerPadron({ lotes, envios });
    assert.equal(p.lotes.length, 7);
    const a2 = p.lotes.filter((l) => l.codigo === "A 2");
    assert.deepEqual(a2.map((l) => l.nombre), ["A 2 (1-3)", "A 2 (4-5)"]);
    assert.deepEqual(p.administraciones.map((a) => [a.sigla, a.orden]), [["1-3", 1], ["4-5", 2], ["6ª", 3], ["7ª", 4]]);
    // El área se lee con punto o con coma; el edificio y la unidad quedan aparte del código.
    assert.equal(a2[1].areaM2, 980.5);
    const proa = p.lotes.find((l) => l.codigo === "B 6Cb")!;
    assert.equal(proa.edificio, "Proa 6"); assert.equal(proa.subunidad, "b"); assert.equal(proa.manzana, "B");
});

test("la situación del lote sale de su estado: terreno, desarrollador, sin titular, o una casa", () => {
    const p = leerPadron({ lotes, envios });
    const de = (c: string, s: string) => p.lotes.find((l) => l.codigo === c && l.sigla === s)!.situacion;
    assert.equal(de("D 4", "7ª"), "TERRENO");
    assert.equal(de("D 8", "4-5"), "SIN_TITULAR");
    assert.equal(de("K 1B", "4-5"), "DESARROLLADOR");
    assert.equal(de("A 2", "1-3"), null);
});

test("una persona es su correo: con todos sus lotes y qué es de cada uno", () => {
    const p = leerPadron({ lotes, envios });
    assert.equal(p.personas.length, 4);
    const marta = p.personas.find((x) => x.email === "marta@ejemplo.uy")!;
    assert.deepEqual(marta.vinculos, [{ sigla: "4-5", codigo: "B 6Cb", vinculo: "PROPIETARIO" }, { sigla: "6ª", codigo: "C 1a", vinculo: "FAMILIA" }]);
    assert.equal(p.personas.find((x) => x.email === "pedro@ejemplo.uy")!.vinculos[0].vinculo, "OCUPANTE");
    // El correo se guarda en minúsculas; la nota entre paréntesis no es un nombre.
    assert.ok(p.personas.some((x) => x.email === "ana@ejemplo.uy"));
    assert.equal(p.personas.find((x) => x.email === "info@ejemplo.uy")!.nombre, "");
});

test("lo que no se entiende se avisa con su renglón y no frena el resto", () => {
    const p = leerPadron({ lotes, envios });
    assert.ok(p.avisos.some((a) => a.includes("renglón 6") && a.includes("Z 9 (1-3)")));       // lote que no figura
    assert.ok(p.avisos.some((a) => a.includes("renglón 7") && a.includes("forma de correo")));
    assert.ok(!p.personas.some((x) => x.email === "nadie@ejemplo.uy"));                        // sin lote reconocible no recibe código
    // Una hoja que falta se dice, y la otra se lee igual.
    const sinEnvios = leerPadron({ lotes, envios: [] });
    assert.equal(sinEnvios.lotes.length, 7); assert.equal(sinEnvios.personas.length, 0);
    assert.ok(sinEnvios.avisos.some((a) => a.includes("Envío de códigos")));
});

test("el mismo correo en dos renglones es una persona con los lotes de los dos", () => {
    const p = leerPadron({ lotes, envios: [CAB_ENVIOS, ["Marta Caso", "marta@ejemplo.uy", 1, "B 6Cb (4-5) propietario", "", null], ["Marta Caso", "MARTA@ejemplo.uy", 1, "C 1a (6ª) propietario", "", null]] });
    assert.equal(p.personas.length, 1); assert.equal(p.personas[0].vinculos.length, 2);
});

test("las columnas se encuentran por su título, no por su lugar", () => {
    const revuelta = [["Lote / unidad", "Estado", "Etapa", "Titular"], ["A 2", "OK", "Etapas 4 y 5", "Carla Muestra"]];
    const p = leerPadron({ lotes: revuelta, envios: [["Lotes y vínculo", "Mail", "Nombre"], ["A 2 (4-5) propietario", "carla@ejemplo.uy", "Carla Muestra"]] });
    assert.equal(p.lotes[0].nombre, "A 2 (4-5)"); assert.equal(p.personas[0].nombre, "Carla Muestra");
});

test("un lote cargado antes («L1») se lleva al código del plano («L 1»), y los nombres se comparan sin tildes", () => {
    assert.equal(codigoDeNombreViejo("L1"), "L 1");
    assert.equal(codigoDeNombreViejo("J11"), "J 11");
    assert.equal(codigoDeNombreViejo("Lote G9"), "G 9");
    assert.equal(codigoDeNombreViejo("Portería"), null);
    assert.ok(compartenNombre("José Pérez Rodríguez", "Maria RODRIGUEZ / Juan Soto"));
    assert.ok(!compartenNombre("José Pérez", "Ana Díaz - Luis Soto"));
    assert.ok(!compartenNombre("Ana de la O", "Luis de la Fe"));           // «de» y «la» no son un apellido
    assert.ok(mismoNombre("  María  José Núñez ", "maria jose nuñez"));
    assert.ok(!mismoNombre("María Núñez", "María José Núñez"));
    assert.ok(!mismoNombre("", ""));
});
