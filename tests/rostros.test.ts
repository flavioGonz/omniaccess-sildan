/** Identidad por rostro (lib-rostros.js): a quién pertenece una cara, y qué es una visita. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { codigoRostro } from "@/lib/rostros";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const R = require("../lib-rostros.js");

const BUENA = { px: 120, prob: 0.98 };
const de = (id: string, similitud: number) => ({ sujeto: R.sujetoDe(id), similitud });

test("una cara nítida que no se parece a nadie funda una identidad", () => {
    assert.deepEqual(R.decidir(BUENA, []), { que: "nueva" });
    assert.deepEqual(R.decidir(BUENA, [de("a", 0.41)]), { que: "nueva" });
});

test("por encima del umbral es la misma persona y la pasada se suma", () => {
    assert.deepEqual(R.decidir(BUENA, [de("a", 0.91), de("b", 0.5)]), { que: "misma", rostroId: "a", similitud: 0.91 });
    assert.equal(R.decidir(BUENA, [de("a", R.UMBRAL_MISMA)]).que, "misma");
});

test("en el medio nace una cara nueva con la sugerencia de unirla: lo medido no deja decidir solo", () => {
    // 0,70 dio la única pareja que parece la misma persona; 0,66 llegó a dar un impostor.
    const d = R.decidir(BUENA, [de("a", 0.7)]);
    assert.equal(d.que, "nueva");
    assert.equal(d.parecidaA, R.sujetoDe("a"));
    assert.equal(d.parecido, 0.7);
    assert.equal(R.decidir(BUENA, [de("a", 0.58)]).parecidaA, undefined);
});

test("una cara chica o dudosa no funda ni suma: se parece a cualquiera", () => {
    // Lo medido: 14 a 20 px en el cuadro chico, y el recorte pixelado de 68 px (0,79) que dio 0,82 contra otra persona.
    assert.deepEqual(R.decidir({ px: 18, prob: 0.96 }, [de("a", 0.95)]), { que: "sin-cara", motivo: "cara chica (18 px)" });
    assert.deepEqual(R.decidir({ px: 110, prob: 0.79 }, [de("a", 0.82)]), { que: "sin-cara", motivo: "cara dudosa (79 %)" });
    assert.equal(R.decidir({ px: R.CARA_PX_MIN, prob: R.CARA_PROB_MIN }, []).que, "nueva");
});

test("el padrón sigue como estaba: su propio umbral, y va antes que la compuerta", () => {
    const juan = [{ sujeto: "Juan Pérez", similitud: 0.93 }];
    assert.deepEqual(R.decidir(BUENA, juan), { que: "padron", sujeto: "Juan Pérez", similitud: 0.93 });
    assert.equal(R.decidir({ px: 40, prob: 0.8 }, juan).que, "padron");
    // Por debajo de su umbral no es Juan: es una cara nueva que se le parece.
    const casi = R.decidir(BUENA, [{ sujeto: "Juan Pérez", similitud: 0.85 }]);
    assert.equal(casi.que, "nueva");
    assert.equal(casi.parecidaA, "Juan Pérez");
});

test("los umbrales salen de los Settings, dentro de lo razonable", () => {
    assert.deepEqual(R.umbrales(), { misma: R.UMBRAL_MISMA, parecida: R.UMBRAL_PARECIDA, padron: 0.89, pxMin: R.CARA_PX_MIN, probMin: R.CARA_PROB_MIN });
    assert.equal(R.umbrales({ misma: "0.9" }).misma, 0.9);
    assert.equal(R.umbrales({ misma: "abc", pxMin: "5" }).misma, R.UMBRAL_MISMA);
    assert.equal(R.umbrales({ pxMin: "5" }).pxMin, R.CARA_PX_MIN);
    // «Parecida» por encima de «misma» dejaría el medio vacío.
    assert.equal(R.umbrales({ misma: "0.7", parecida: "0.9" }).parecida, 0.7);
    assert.equal(R.decidir(BUENA, [de("a", 0.85)], R.umbrales({ misma: "0.9" })).que, "nueva");
});

test("una visita: verla de nuevo a los minutos no cuenta otra vez", () => {
    const t = new Date("2026-11-13T12:00:00Z");
    assert.equal(R.esOtraVisita(t, new Date(t.getTime() + 2 * 60_000)), false);
    assert.equal(R.esOtraVisita(t, new Date(t.getTime() + R.VISITA_MS + 1000)), true);
    assert.equal(R.esOtraVisita(null, t), true);
});

test("ejemplos y foto: otro ángulo suma, la misma foto no; la foto se cambia sólo por una claramente mejor", () => {
    assert.equal(R.sumaEjemplo(1, 0.86), true);
    assert.equal(R.sumaEjemplo(1, 0.99), false);
    assert.equal(R.sumaEjemplo(R.EJEMPLOS_MAX, 0.86), false);
    assert.equal(R.esMejorFoto(140, 100), true);
    assert.equal(R.esMejorFoto(105, 100), false);
});

test("el número se escribe igual en el proceso de visión y en el panel", () => {
    for (const n of [0, 7, 42, 1234, 123456]) assert.equal(R.codigo(n), codigoRostro(n));
    assert.equal(R.codigo(42), "R-0042");
    assert.equal(R.idDeSujeto(R.sujetoDe("abc")), "abc");
    assert.equal(R.idDeSujeto("Juan Pérez"), null);
});
