import test from "node:test";
import assert from "node:assert/strict";
import { costoEntre, masParecidas, posicionesDistintas, seConfunden } from "@/lib/chapas-parecidas";

test("parecidas: el OCR confunde 8 con B y 0 con O, no K con 3", () => {
    assert.ok(seConfunden("8", "B")); assert.ok(seConfunden("O", "0")); assert.ok(!seConfunden("K", "3"));
});
test("parecidas: una confusión típica cuesta poco, una letra cualquiera cuesta uno, y falta una también", () => {
    assert.equal(costoEntre("BEA8032", "BEA8032"), 0);
    assert.ok(costoEntre("BEA8032", "8EA8032") < 0.5);
    assert.equal(costoEntre("BEA8032", "BKA8032"), 1);
    assert.equal(costoEntre("SDH6448", "SDH644"), 1, "el recorte se comió un carácter");
    assert.ok(costoEntre("BEA8032", "BEA6012") > 0.5, "dos números distintos no es «una confusión»");
});
test("parecidas: se ordenan de la más cercana a la más lejana y se marca qué cambia", () => {
    const padron = [{ plate: "SDH6448", quien: "A" }, { plate: "SDM6448", quien: "B" }, { plate: "ABC1234", quien: "C" }, { plate: "SDH6448", quien: "dup" }];
    const r = masParecidas("SDH644B", padron);
    assert.equal(r[0].plate, "SDH6448"); assert.equal(r[0].quien, "A");
    assert.deepEqual(r[0].distintas, [6]);
    assert.ok(!r.some((x) => x.plate === "ABC1234"));
    assert.equal(r.filter((x) => x.plate === "SDH6448").length, 1, "sin repetidas");
    assert.deepEqual(posicionesDistintas("SCL9390", "SCE9390"), [2]);
});
test("parecidas: una consulta muy corta no busca", () => {
    assert.deepEqual(masParecidas("AB1", [{ plate: "AB12" }]), []);
});
