/** ¿La chapa consultada puede ser otra, mal leída? (lib/chapas-parecidas) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { diferencias, variantesMasLeidas } from "@/lib/chapas-parecidas";

test("el caso del 13/11: SCH1707 leída una vez, donde SDH1707 se leyó dieciocho", () => {
    const semana = [{ chapa: "SDH1707", lecturas: 18 }, { chapa: "SDM1707", lecturas: 7 }, { chapa: "SCH1707", lecturas: 1 }, { chapa: "SCM1707", lecturas: 1 }, { chapa: "SDN3706", lecturas: 2 }, { chapa: "ABC1234", lecturas: 40 }];
    const r = variantesMasLeidas("SCH1707", semana);
    assert.equal(r.propias, 1);
    assert.deepEqual(r.parecidas, [{ chapa: "SDH1707", lecturas: 18 }, { chapa: "SDM1707", lecturas: 7 }]);
});

test("la chapa que más se leyó no tiene de quién dudar; y una que nunca se leyó (escrita a mano), tampoco se inventa", () => {
    const semana = [{ chapa: "SDH1707", lecturas: 18 }, { chapa: "SCH1707", lecturas: 1 }];
    assert.deepEqual(variantesMasLeidas("SDH1707", semana).parecidas, []);
    assert.deepEqual(variantesMasLeidas("XYZ9999", semana), { propias: 0, parecidas: [] });
});

test("parecida es una o dos letras del mismo largo: ni tres, ni otro largo", () => {
    assert.equal(diferencias("SCH1707", "SDH1707"), 1);
    assert.equal(diferencias("SCH1707", "SDM1707"), 2);
    assert.equal(diferencias("SCH1707", "SUH177"), Infinity);
    assert.deepEqual(variantesMasLeidas("SCH1707", [{ chapa: "SDM1708", lecturas: 50 }, { chapa: "SUH177", lecturas: 50 }]).parecidas, []);
});
