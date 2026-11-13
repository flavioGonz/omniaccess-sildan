/** El menú del objeto tocado en el vivo (lib/vivo-menu): qué se busca, desde dónde se ve la llegada y cuál objeto es. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { claseDeBusqueda, elegirPorCaja, motivoDesdeVivo } from "@/lib/vivo-menu";

test("la clase de la búsqueda: los tres grupos conocidos, y lo demás es un objeto", () => {
    assert.equal(claseDeBusqueda("persona"), "persona");
    assert.equal(claseDeBusqueda("vehiculo"), "vehiculo");
    assert.equal(claseDeBusqueda("animal"), "animal");
    assert.equal(claseDeBusqueda("propio"), "objeto");
    assert.equal(claseDeBusqueda(""), "objeto");
});

test("el objeto tocado: el que más se pisa con la caja, aunque no sea el más grande", () => {
    const grande = { id: "camion", caja: [0.1, 0.1, 0.6, 0.6] };
    const tocado = { id: "auto", caja: [0.70, 0.50, 0.82, 0.62] };
    const vecino = { id: "otro", caja: [0.83, 0.50, 0.95, 0.62] };
    // La foto se analiza aparte: la caja llega corrida un poco.
    assert.equal(elegirPorCaja([grande, tocado, vecino], [0.71, 0.51, 0.83, 0.63])?.id, "auto");
});

test("si ya se corrió (alguien caminando), el más cercano; y si no hay nadie cerca, ninguno", () => {
    const persona = { id: "p", caja: [0.50, 0.40, 0.56, 0.60] };
    // Se tocó acá y medio segundo después está al lado: no se pisan, pero su centro quedó a menos de una caja.
    assert.equal(elegirPorCaja([persona], [0.42, 0.40, 0.48, 0.60])?.id, "p");
    // Lejos: no se adivina.
    assert.equal(elegirPorCaja([persona], [0.05, 0.05, 0.10, 0.20]), null);
    assert.equal(elegirPorCaja([persona], null), null);
    assert.equal(elegirPorCaja([], [0, 0, 1, 1]), null);
});

test("el motivo propuesto dice dónde y desde cuándo, y no inventa una hora que no hay", () => {
    const ahora = new Date("2026-11-13T15:00:00-03:00").getTime();
    assert.equal(motivoDesdeVivo("Calle 22", new Date("2026-11-13T09:14:00-03:00").getTime(), ahora), "Sospechoso: marcado desde el vivo de Calle 22, en su lugar desde las 09:14");
    assert.equal(motivoDesdeVivo("Calle 22", new Date("2026-11-11T22:05:00-03:00").getTime(), ahora), "Sospechoso: marcado desde el vivo de Calle 22, en su lugar desde el 11/11 a las 22:05");
    assert.equal(motivoDesdeVivo("Calle 22", null, ahora), "Sospechoso: marcado desde el vivo de Calle 22");
    assert.equal(motivoDesdeVivo("  ", undefined, ahora), "Sospechoso: marcado desde el vivo de una cámara");
});
