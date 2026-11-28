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

/* ── 28/11: las series particulares de cada departamento (medidas en el lab, 90 días) ── */

test("Montevideo: adentro de la serie particular sólo valen los códigos acordados", () => {
    // SCM son autos particulares de la serie SC (31 chapas, como SCL y SCN): no un concejal.
    assert.equal(leerChapa("SCM1234")?.categoria, null);
    assert.equal(leerChapa("SCM1234")?.frase, "Particular de Montevideo");
    assert.equal(tipoDeChapa("SCM1234"), null);
    assert.ok(!prefijosDeTipo("oficial").includes("SCM"), "el filtro «Oficial» ya no trae los SCM");
    // SDA es la serie particular: «DA» (alquiler viejo) ni siquiera está cargado.
    assert.equal(leerChapa("SDA1234")?.categoria, null);
    assert.equal(leerChapa("SDU1234")?.categoria, null, "«demostración» no es del acuerdo: SDU va a ser serie particular");
    // Los acordados sí: la serie se los saltea (SCC, SCD, SDI, SDP, SAT, SAL, SAM).
    for (const [chapa, corto] of [["SCC1234", "Consular"], ["SCD1234", "Diplomático"], ["SDI1234", "Discapacidad"], ["SDP1234", "Deportivo"], ["SAT1234", "Temporaria"], ["SAL1234", "Alquiler"], ["SAM1234", "Ambulancia"]]) {
        assert.equal(leerChapa(chapa)?.categoria?.corto, corto, chapa);
        assert.equal(leerChapa(chapa)?.confianza, "alta", chapa);
    }
    // Fuera de la serie particular, todo como antes.
    assert.equal(leerChapa("STX1234")?.categoria?.corto, "Taxi");
    assert.equal(leerChapa("SLQ1234")?.categoria?.corto, "Alquiler");
    assert.equal(leerChapa("SMA1234")?.categoria?.corto, "Maquinaria");
});

test("Montevideo: las motos tienen su serie (SM, SN, SO, SP), y ahí tampoco se inventa", () => {
    assert.equal(leerChapa("SMZ123")?.categoria, null, "una moto SMZ no es un remolque");
    assert.equal(leerChapa("SMZ123")?.frase, "Moto particular de Montevideo");
    assert.equal(leerChapa("SMT123")?.categoria, null);
    assert.equal(leerChapa("SMZ1234")?.categoria?.corto, "Remolque", "con cuatro números no es de la serie de motos");
    assert.equal(leerChapa("SMI123")?.categoria?.corto, "Policía / Bomberos", "MI es acordado: vale también en moto");
    assert.equal(leerChapa("SPA229")?.frase, "Moto particular de Montevideo");
});

test("el interior: la segunda letra puede ser la localidad aunque no empiece con A–H", () => {
    // Melo es EM y Mercedes KM: EMD y KMD no son «Defensa», ni EMA «Maquinaria».
    for (const c of ["EMD1234", "KMD1234", "EMA1234", "KMA1234"]) { assert.equal(leerChapa(c)?.categoria, null, c); assert.equal(tipoDeChapa(c), null, c); }
    assert.equal(leerChapa("EMD1234")?.frase, "Particular de Cerro Largo");
    assert.ok(!prefijosDeTipo("militar").includes("EMD") && !prefijosDeTipo("militar").includes("KMD"));
    assert.ok(prefijosDeTipo("militar").includes("AMD"), "donde la M no es serie particular, sigue valiendo");
    // FR es Rivera: FRE no se afirma remise. En Canelones la R no es serie: ARE sí.
    assert.equal(leerChapa("FRE1234")?.categoria, null);
    assert.equal(leerChapa("ARE1234")?.categoria?.corto, "Remise");
    // Canelones: AP es serie particular (9 chapas): APR no es «provisoria».
    assert.equal(leerChapa("APR1234")?.categoria, null);
    // Los T siguen valiendo en todos lados: no hay localidad con T.
    assert.equal(leerChapa("ATX1234")?.categoria?.corto, "Taxi");
    assert.equal(leerChapa("CTX1234")?.frase, "Taxi de Rocha");
});

test("Maldonado dice la localidad, en la chapa nueva y en la vieja", () => {
    assert.equal(leerChapa("BEA1234")?.localidad, "Punta del Este");
    assert.equal(leerChapa("BEA1234")?.frase, "Particular de Maldonado (Punta del Este)");
    assert.equal(leerChapa("BBA1234")?.frase, "Particular de Maldonado (San Carlos)");
    assert.equal(leerChapa("BLA1234")?.frase, "Particular de Maldonado", "BL existe (13 chapas) pero ninguna fuente dice de dónde es");
    assert.equal(leerChapa("BED1234")?.categoria, null, "BED es Punta del Este, no un edil");
    assert.equal(leerChapa("B590612")?.frase, "Chapa vieja de Maldonado (Punta del Este)");
    assert.equal(leerChapa("B390612")?.frase, "Chapa vieja de Maldonado", "el 3 no está en las fuentes: no se adivina");
    assert.equal(leerChapa("AAA1234")?.localidad ?? null, null);
});

test("una chapa con forma uruguaya que empieza con T–Z no es de ningún departamento", () => {
    for (const c of ["TAB1234", "XYZ1234", "WAB123"]) {
        const l = leerChapa(c);
        assert.equal(l?.sinDepartamento, true, c);
        assert.equal(l?.departamento, null, c);
        assert.equal(l?.frase, "Sin departamento: extranjera o mal leída", c);
    }
    assert.equal(leerChapa("SBO1234")?.sinDepartamento ?? false, false);
});

test("los códigos y series que faltaban", () => {
    assert.equal(leerChapa("SRA1234")?.categoria?.corto, "Remise");
    assert.equal(tipoDeChapa("SRA1234"), "remise");
    assert.equal(tipoDeChapa("SMT1234"), "transporte");
    assert.equal(tipoDeChapa("SHA1234"), "alquiler");
    assert.equal(leerChapa("BHA1234")?.categoria, null, "BHA es Solís (Maldonado), no un alquiler: en el interior HA no se afirma");
    assert.equal(leerChapa("SPE1234")?.categoria?.corto, "Presidencia");
    assert.equal(leerChapa("BCC1234")?.categoria, null, "BC es Pan de Azúcar: no se afirma «consular»");
});
