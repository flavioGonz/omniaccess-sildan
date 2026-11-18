/** Lo que dice una matrícula uruguaya de su vehículo (lib/categoria-chapa). */
import test from "node:test";
import assert from "node:assert/strict";
import { leerChapa, prefijosDeTipo, tipoDeChapa, TIPOS_CHAPA } from "@/lib/categoria-chapa";

test("Montevideo: la categoría es segura", () => {
    assert.equal(leerChapa("STX1234")?.frase, "Taxi de Montevideo");
    assert.equal(leerChapa("STX1234")?.confianza, "alta");
    assert.equal(leerChapa("SAM1234")?.categoria?.grupo, "emergencia");
    assert.equal(leerChapa("SCD0150")?.categoria?.grupo, "diplomatico");
    assert.equal(leerChapa("SMI1234")?.categoria?.corto, "Policía / Bomberos");
});

test("el interior: lo que choca con una localidad no se afirma", () => {
    // Canelones ya tiene AAM, AAT, AAU, AAL particulares: AM en el interior NO es ambulancia.
    assert.equal(leerChapa("AAM1234")?.categoria, null);
    assert.match(String(leerChapa("AAM1234")?.frase), /Particular de Canelones/);
    // TX no choca con ninguna localidad: en el interior vale, pero como «probable».
    assert.equal(leerChapa("ATX1234")?.categoria?.corto, "Taxi");
    assert.equal(leerChapa("ATX1234")?.confianza, "probable");
});

test("las series de tres letras se reconocen enteras", () => {
    assert.equal(leerChapa("ENA1234")?.categoria?.corto, "Ejército");
    assert.equal(leerChapa("SJP123")?.categoria?.grupo, "emergencia");
    // Sumadas el 18/11: series propias de un departamento.
    assert.equal(leerChapa("AIC1234")?.categoria?.corto, "Intendencia");
    assert.equal(leerChapa("GAT1234")?.categoria?.corto, "Taxi");
    assert.equal(tipoDeChapa("GAT1234"), "taxi");
    assert.equal(tipoDeChapa("HOM1234"), "transporte");
});

test("los códigos nuevos del relevamiento del 18/11", () => {
    assert.equal(leerChapa("STI1234")?.categoria?.corto, "Interurbano");
    assert.equal(leerChapa("SID1234")?.categoria?.corto, "Intendencia");
    assert.equal(leerChapa("SMP1234")?.categoria?.grupo, "emergencia");
    assert.equal(leerChapa("SNG1234")?.categoria?.grupo, "diplomatico");
    assert.equal(tipoDeChapa("SME1234"), "medico");
    assert.equal(tipoDeChapa("SMA1234"), "maquinaria");
});

test("una particular no inventa categoría", () => {
    assert.equal(leerChapa("SBO1234")?.categoria, null);
    assert.equal(tipoDeChapa("SBO1234"), null);
    assert.equal(leerChapa("ABC1D23")?.extranjera, "Brasil");
});

test("cada tipo del filtro sabe sus prefijos, y las series van enteras", () => {
    for (const t of TIPOS_CHAPA) assert.ok(prefijosDeTipo(t.id).length > 0, t.id);
    assert.ok(prefijosDeTipo("taxi").includes("STX"));
    assert.ok(prefijosDeTipo("taxi").includes("GAT"));
    assert.ok(prefijosDeTipo("oficial").includes("AIC"));
    // AM sólo en Montevideo: en el interior choca con la serie particular.
    assert.deepEqual(prefijosDeTipo("ambulancia"), ["SAM"]);
});
