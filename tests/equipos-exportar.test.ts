/** El inventario y el paquete de equipos (lib/informes/equipos-datos, lib/equipos-paquete; 26/11). */
import test from "node:test";
import assert from "node:assert/strict";
import { aplanarAreas, retencionTxt, discoBien, tiempoPrendido } from "@/lib/informes/equipos-datos";
import { cifrar, descifrar } from "@/lib/equipos-paquete";

test("inventario: las áreas salen en orden de árbol, con su camino", () => {
    const a = aplanarAreas([
        { id: "p", nombre: "Perímetro", padre: "r", orden: 1 }, { id: "r", nombre: "San Nicolás", padre: null, orden: 0 },
        { id: "l", nombre: "LPR", padre: "r", orden: 0 }, { id: "n", nombre: "Norte", padre: "p", orden: 0 },
    ]);
    assert.deepEqual(a.map((x) => x.camino), ["San Nicolás", "San Nicolás › LPR", "San Nicolás › Perímetro", "San Nicolás › Perímetro › Norte"]);
    assert.equal(a[3].nivel, 2);
});
test("inventario: retención, discos y prendido en palabras", () => {
    assert.equal(retencionTxt({ dias: 31, desde: "2026-10-26", grabando: true, calculado: "" }), "31 días");
    assert.equal(retencionTxt({ dias: 12, desde: "2026-11-14", grabando: false, calculado: "" }), "12 días · NO graba");
    assert.equal(retencionTxt(null), "—");
    assert.ok(discoBien("ok") && discoBien("sleeping") && !discoBien("error") && !discoBien("unformatted"));
    assert.equal(tiempoPrendido(3 * 86400 + 5 * 3600), "3 d 5 h");
});
test("paquete: los secretos se abren sólo con la frase", () => {
    const secreto = JSON.stringify({ abc: { usuario: "admin", clave: "x-no-es-real", rtsp: null } });
    const c = cifrar(secreto, "una frase larga de prueba");
    assert.ok(!JSON.stringify(c).includes("x-no-es-real"), "nada en claro");
    assert.equal(descifrar(c, "una frase larga de prueba"), secreto);
    assert.throws(() => descifrar(c, "otra frase cualquiera"));
});
