/** Qué cambió en un lote (lib/lote-cambios). Datos inventados. */
import test from "node:test";
import assert from "node:assert/strict";
import { compararLote, contarPorClase, diferenciaDeCarga, diferenciasDeDatos, estadoDeLotes, firmaDeCambio, fraseDeCarga, leerEstado, ESTADO_VACIO, type EstadoLote } from "@/lib/lote-cambios";

const ana = { id: "u1", nombre: "Ana Prueba" }, beto = { id: "u2", nombre: "Beto Ejemplo" };
const lote = (personas: typeof ana[], chapas: [string, string][]): EstadoLote => ({ personas, chapas: chapas.map(([chapa, userId]) => ({ chapa, userId })) });

test("la foto junta las dos formas de una matrícula y la lleva a todos los lotes de la persona", () => {
    const f = estadoDeLotes([
        // La misma chapa como vehículo («SBC 1234») y como credencial («sbc1234») es una.
        { id: "u1", nombre: "Ana Prueba", lotes: ["A", "B", "A"], chapas: ["SBC 1234", "sbc1234", "AAA1111"] },
        { id: "u2", nombre: "Beto Ejemplo", lotes: ["A"], chapas: [] },
        { id: "u3", nombre: "Sin lote", lotes: [], chapas: ["ZZZ9999"] },
    ]);
    assert.deepEqual([...f.keys()].sort(), ["A", "B"]);
    assert.deepEqual(f.get("A")!.chapas.map((c) => c.chapa), ["AAA1111", "SBC1234"]);
    assert.deepEqual(f.get("A")!.personas.map((p) => p.id), ["u1", "u2"]);
    assert.deepEqual(f.get("B")!.chapas.map((c) => c.chapa), ["AAA1111", "SBC1234"]);
});

test("dos fotos iguales no dan ningún cambio, vengan en el orden que vengan", () => {
    const a = estadoDeLotes([{ id: "u2", nombre: "Beto", lotes: ["A"], chapas: ["B2"] }, { id: "u1", nombre: "Ana", lotes: ["A"], chapas: ["A1"] }]).get("A")!;
    const b = estadoDeLotes([{ id: "u1", nombre: "Ana", lotes: ["A"], chapas: ["A1"] }, { id: "u2", nombre: "Beto", lotes: ["A"], chapas: ["B2"] }]).get("A")!;
    assert.deepEqual(compararLote(a, b), []);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("cambiar de auto se lee como baja y después alta, con de quién es", () => {
    const c = compararLote(lote([ana], [["ABC1234", "u1"]]), lote([ana], [["DEF5678", "u1"]]));
    assert.deepEqual(c.map((x) => [x.que, x.chapa, x.persona]), [["MATRICULA_BAJA", "ABC1234", "Ana Prueba"], ["MATRICULA_ALTA", "DEF5678", "Ana Prueba"]]);
});

test("quien se va del lote se lleva sus matrículas, y queda dicho cuáles", () => {
    const c = compararLote(lote([ana, beto], [["ABC1234", "u1"], ["BBB2222", "u2"]]), lote([ana], [["ABC1234", "u1"]]));
    assert.deepEqual(c.map((x) => x.que), ["PERSONA_BAJA", "MATRICULA_BAJA"]);
    assert.equal(c[0].persona, "Beto Ejemplo");
    assert.match(c[0].detalle!, /BBB2222/);
    // El nombre de quien se fue sale de la foto vieja: en la nueva ya no está.
    assert.equal(c[1].persona, "Beto Ejemplo");
});

test("un lote que no se había visto nunca: todo lo que tiene es nuevo", () => {
    const c = compararLote(ESTADO_VACIO, lote([ana], [["ABC1234", "u1"]]));
    assert.deepEqual(c.map((x) => x.que), ["PERSONA_ALTA", "MATRICULA_ALTA"]);
});

test("una matrícula que pasa de una persona a otra de la misma casa no es un cambio del lote", () => {
    assert.deepEqual(compararLote(lote([ana, beto], [["ABC1234", "u1"]]), lote([ana, beto], [["ABC1234", "u2"]])), []);
});

test("lo guardado que vino roto no rompe: se descarta", () => {
    assert.deepEqual(leerEstado(null, "x"), ESTADO_VACIO);
    assert.deepEqual(leerEstado([{ id: "u1", nombre: "Ana" }, { nombre: "sin id" }, 7], [{ chapa: "A1", userId: "u1" }, { chapa: "" }]), { personas: [{ id: "u1", nombre: "Ana" }], chapas: [{ chapa: "A1", userId: "u1" }] });
});

test("la carga del censo, contra lo que el lote tenía", () => {
    const d = diferenciaDeCarga(["ABC1234", "OLD0001"], ["abc 1234", "NEW0002", "NEW0002"]);
    assert.deepEqual(d, { nuevas: ["NEW0002"], siguen: ["ABC1234"], faltan: ["OLD0001"] });
    assert.equal(fraseDeCarga(d), "Declaró 2 matrículas. Nueva: NEW0002. No nombró OLD0001, que el lote tiene.");
    assert.equal(fraseDeCarga(diferenciaDeCarga(["ABC1234"], ["ABC1234"])), "Declaró 1 matrícula. Las mismas que ya tenía.");
    assert.equal(fraseDeCarga(diferenciaDeCarga([], [])), "No declaró ninguna matrícula.");
});

test("la firma dice quién y por dónde, y cuando no se sabe lo dice", () => {
    assert.equal(firmaDeCambio({ quien: "Ana Prueba", origen: "censo" }), "Ana Prueba, por el censo");
    assert.equal(firmaDeCambio({ quien: "operador", origen: "panel" }), "operador, desde el panel");
    assert.match(firmaDeCambio({ quien: null, origen: "sistema" }), /No se sabe quién/);
});

test("lote a mano: lo que cambió se dice con lo de antes y lo de ahora; lo vacío también", () => {
    const r = { titular: "Titular", situacion: "Situación" };
    assert.deepEqual(diferenciasDeDatos({ titular: "Ana", situacion: "terreno" }, { titular: "Ana y Beto" }, r), ["Titular: «Ana» → «Ana y Beto»"]);
    assert.deepEqual(diferenciasDeDatos({ titular: "Ana", situacion: null }, { titular: "", situacion: "terreno" }, r), ["Titular: «Ana» → vacío", "Situación: vacío → «terreno»"]);
    assert.deepEqual(diferenciasDeDatos({ titular: "Ana  Pérez", situacion: null }, { titular: " Ana Pérez " }, r), [], "espacios de más no son un cambio");
    assert.deepEqual(diferenciasDeDatos({ titular: "Ana", situacion: null }, {}, r), [], "lo que no se mandó no se compara");
});
test("lote a mano: las correcciones cuentan en su filtro", () => {
    const n = contarPorClase([{ que: "DATO_CAMBIADO" }, { que: "PERSONA_EDITADA" }, { que: "MATRICULA_ALTA" }]);
    assert.equal(n.datos, 1); assert.equal(n.personas, 1); assert.equal(n.matriculas, 1); assert.equal(n.todos, 3);
});
