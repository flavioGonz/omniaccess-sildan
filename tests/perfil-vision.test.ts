/** El perfil de OmniVision de una chapa y la señal «no se parece» (lib/perfil-vision). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { observacion, perfilDe, noSeParece, rectDeDetalles, vehiculoDeLaChapa, type ObjetoVisto } from "@/lib/perfil-vision";

const auto = (caja: number[], color: string, carroceria: string, prob = 0.8): ObjetoVisto => ({ grupo: "vehiculo", caja, atributos: [{ id: "color", valor: color, prob }, { id: "carroceria", valor: carroceria, prob }] });
const obsDe = (color: string, carroceria: string, vehiculos = 1, prob = 0.8) => ({ color, carroceria, pColor: prob, pCarroceria: prob, vehiculos });

test("lee el recuadro de la chapa del detalle ANPR", () => {
    assert.deepEqual(rectDeDetalles("Marca: X, PlateRect: 400/600/100/40, PlateCrop: a.jpg"), { cx: 0.45, cy: 0.62 });
    assert.equal(rectDeDetalles("Marca: X"), null);
});

test("elige el vehículo que tiene la chapa en su mitad de abajo, el de adelante", () => {
    const lejos = auto([0.3, 0.2, 0.6, 0.5], "rojo", "pickup");
    const cerca = auto([0.2, 0.3, 0.8, 0.9], "blanco", "sedán");
    assert.equal(vehiculoDeLaChapa([lejos, cerca], { cx: 0.45, cy: 0.75 }), cerca);
    // Sin recuadro y con dos autos no se adivina.
    assert.equal(vehiculoDeLaChapa([lejos, cerca], null), null);
    assert.equal(vehiculoDeLaChapa([cerca], null), cerca);
});

test("los atributos dudosos no cuentan", () => {
    const o = observacion([{ grupo: "vehiculo", caja: [0, 0, 1, 1], atributos: [{ id: "color", valor: "rojo", prob: 0.9, dudoso: true }] }], null);
    assert.equal(o, null);
});

test("perfil: la mayoría, y fuerte sólo con cinco lecturas y mayoría clara agrupada", () => {
    const p = perfilDe([obsDe("blanco", "sedán"), obsDe("blanco", "hatchback"), obsDe("plateado", "sedán"), obsDe("blanco", "sedán"), obsDe("blanco", "sedán")]);
    assert.equal(p.color?.valor, "blanco");
    assert.equal(p.carroceria?.valor, "sedán");
    // plateado no es «claro»: 4 de 5 claros = 0,8 ≥ 0,7; sedán/hatchback son el mismo grupo.
    assert.equal(p.fuerte, true);
    assert.equal(perfilDe([obsDe("blanco", "sedán"), obsDe("blanco", "sedán")]).fuerte, false);
});

test("no se parece: color y carrocería distintos, con un solo vehículo en la foto", () => {
    const p = perfilDe(Array.from({ length: 8 }, () => obsDe("blanco", "sedán")));
    assert.deepEqual(noSeParece(obsDe("rojo", "pickup"), p), { color: "rojo", carroceria: "pickup" });
    // Sólo el color: puede ser la luz.
    assert.equal(noSeParece(obsDe("rojo", "sedán"), p), null);
    // Hatchback es «un auto» como sedán.
    assert.equal(noSeParece(obsDe("rojo", "hatchback"), p), null);
    // Con dos vehículos en la foto, no se afirma nada.
    assert.equal(noSeParece(obsDe("rojo", "pickup", 2), p), null);
    // Con poca confianza, tampoco.
    assert.equal(noSeParece(obsDe("rojo", "pickup", 1, 0.5), p), null);
});
