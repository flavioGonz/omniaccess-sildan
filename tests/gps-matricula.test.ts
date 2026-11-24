import test from "node:test";
import assert from "node:assert/strict";
import { leerMatriculaGps, limpiarMatricula } from "@/lib/gps-matricula";

test("se guarda como se compara con lo que leen las cámaras: sin espacios ni guiones, en mayúsculas", () => {
    assert.equal(limpiarMatricula("sc j8731"), "SCJ8731");
    assert.equal(limpiarMatricula(" AAA-1234 "), "AAA1234");
    assert.equal(limpiarMatricula(null), "");
    assert.deepEqual(leerMatriculaGps("sc j8731"), { chapa: "SCJ8731" });
});

test("vacía es válida: es sacarle la matrícula", () => {
    assert.deepEqual(leerMatriculaGps(""), { chapa: "" });
    assert.deepEqual(leerMatriculaGps("  -  "), { chapa: "" });
});

test("ni dos letras sueltas ni un renglón entero", () => {
    assert.ok("error" in leerMatriculaGps("AB1"));
    assert.ok("error" in leerMatriculaGps("ABCDEFGH123"));
    assert.deepEqual(leerMatriculaGps("AB12"), { chapa: "AB12" });
    assert.deepEqual(leerMatriculaGps("ABCDE12345"), { chapa: "ABCDE12345" });
});
