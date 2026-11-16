import test from "node:test";
import assert from "node:assert/strict";
import { avisoDeVecina, tituloDeAviso, VIGENTE_MS, type LecturaDeLista } from "@/lib/aviso-vecina";

const AHORA = Date.parse("2026-11-16T12:00:00Z");
const l = (p: Partial<LecturaDeLista> & { id: string }): LecturaDeLista =>
    ({ ts: new Date(AHORA - 60_000).toISOString(), plate: "ABC1234", decision: "", sentido: "", listaNegra: false, ...p } as LecturaDeLista);

test("sin chapas vigiladas no hay aviso", () => {
    assert.equal(avisoDeVecina([l({ id: "1" }), l({ id: "2", plate: null })], AHORA), null);
});

test("la negra manda sobre la amarilla aunque la amarilla sea más nueva", () => {
    const a = avisoDeVecina([
        l({ id: "negra", lista: "negra", plate: "AAA1111", ts: new Date(AHORA - 300_000).toISOString() }),
        l({ id: "amarilla", lista: "amarilla", plate: "BBB2222", ts: new Date(AHORA - 10_000).toISOString() }),
    ], AHORA);
    assert.equal(a?.lista, "negra");
    assert.equal(a?.plate, "AAA1111");
});

test("entre dos de la misma lista gana la más reciente", () => {
    const a = avisoDeVecina([
        l({ id: "viejo", lista: "amarilla", plate: "AAA1111", ts: new Date(AHORA - 300_000).toISOString() }),
        l({ id: "nuevo", lista: "amarilla", plate: "BBB2222", ts: new Date(AHORA - 10_000).toISOString() }),
    ], AHORA);
    assert.equal(a?.lecturaId, "nuevo");
});

test("una lectura vieja no enciende la minicámara", () => {
    const vieja = l({ id: "1", lista: "negra", ts: new Date(AHORA - VIGENTE_MS - 1000).toISOString() });
    assert.equal(avisoDeVecina([vieja], AHORA), null);
});

test("pero si la sigue viendo el aviso no vence", () => {
    const a = avisoDeVecina([l({
        id: "1", lista: "negra", sigue: true,
        ts: new Date(AHORA - 6 * 3600_000).toISOString(),
        vistaHasta: new Date(AHORA - 20_000).toISOString(),
    })], AHORA);
    assert.equal(a?.sigue, true);
    // La fecha exacta del aviso es la última vez que la vio, no cuándo empezó la estadía.
    assert.equal(a?.vistaHasta, new Date(AHORA - 20_000).toISOString());
});

test("los títulos dicen lo mismo que la silueta del vivo", () => {
    assert.equal(tituloDeAviso({ lista: "negra" } as any), "Lista negra detectada");
    assert.equal(tituloDeAviso({ lista: "amarilla" } as any), "Alerta Amarilla detectada");
});
