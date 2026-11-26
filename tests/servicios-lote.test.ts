import test from "node:test";
import assert from "node:assert/strict";
import { cuandoViene, delCenso, diasEnPalabras, mismoServicio, ordenarDias, rotuloServicio } from "@/lib/servicios-lote";

test("servicios-lote: los días se ordenan por semana, sin repetir y sin inventar", () => {
    assert.deepEqual(ordenarDias(["vie", "lun", "vie", "feriado"]), ["lun", "vie"]);
    assert.deepEqual(ordenarDias(null), []);
});
test("servicios-lote: los días se dicen en palabras", () => {
    assert.equal(diasEnPalabras(["lun", "mar", "mié", "jue", "vie"]), "lun a vie");
    assert.equal(diasEnPalabras(["lun", "mié", "vie"]), "lun, mié y vie");
    assert.equal(diasEnPalabras(["sáb"]), "sáb");
    assert.equal(diasEnPalabras(["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]), "todos los días");
    assert.equal(diasEnPalabras(["lun", "mar"]), "lun y mar", "dos seguidos no son un rango");
});
test("servicios-lote: cuándo viene junta días y horario, y no inventa lo que falta", () => {
    assert.equal(cuandoViene({ dias: ["mar", "jue"], desde: "08:00", hasta: "12:00" }), "mar y jue · 08:00 a 12:00");
    assert.equal(cuandoViene({ dias: [], desde: null, hasta: null }), "");
    assert.equal(cuandoViene({ dias: ["lun"], desde: "09:00" }), "lun · 09:00 a ?");
});
test("servicios-lote: el mismo servicio se reconoce por tipo y nombre, o por matrícula", () => {
    assert.ok(mismoServicio({ tipo: "JARDINERO", nombre: "Ramón Pérez" }, { tipo: "JARDINERO", nombre: "ramon perez " }));
    assert.ok(!mismoServicio({ tipo: "JARDINERO", nombre: "Ramón" }, { tipo: "PISCINERO", nombre: "Ramón" }));
    assert.ok(mismoServicio({ tipo: "JARDINERO", nombre: "", chapa: "SBA1234" }, { tipo: "OTRO", nombre: "Juan", chapa: "sba1234" }));
});
test("servicios-lote: un servicio del censo pasa a la forma de la tabla", () => {
    assert.deepEqual(delCenso({ tipo: "PISCINERO", dias: ["vie", "lun"] }), { tipo: "PISCINERO", nombre: "", dias: ["lun", "vie"], desde: null, hasta: null, chapa: null });
    assert.equal(rotuloServicio("JARDINERO"), "Jardinero");
    assert.equal(rotuloServicio("RARO"), "RARO");
});
