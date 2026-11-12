/** La fecha de revisión de la Lista Amarilla (lib/padron: estadoRevision, textoRevision). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoRevision, textoRevision, proximaRevision, REVISION_DIAS } from "@/lib/padron";

const ahora = new Date("2026-11-12T13:00:00Z");
const en = (dias: number) => new Date(ahora.getTime() + dias * 86_400_000);

test("recién cargada: al día, a 30 días", () => {
    assert.equal(REVISION_DIAS, 30);
    const e = estadoRevision(proximaRevision(ahora), ahora);
    assert.deepEqual(e, { estado: "al-dia", dias: 30 });
    assert.equal(textoRevision(e), "en 30 días");
});

test("a 6 días sigue al día; a 5 ya está por vencer", () => {
    assert.deepEqual(estadoRevision(en(6), ahora), { estado: "al-dia", dias: 6 });
    assert.deepEqual(estadoRevision(en(5), ahora), { estado: "por-vencer", dias: 5 });
    assert.equal(textoRevision(estadoRevision(en(1), ahora)), "vence en 1 día");
});

test("el día mismo: vence hoy, todavía no venció", () => {
    assert.deepEqual(estadoRevision(en(0), ahora), { estado: "por-vencer", dias: 0 });
    assert.equal(textoRevision(estadoRevision(new Date(ahora.getTime() + 3_600_000), ahora)), "vence en 1 día");
    assert.equal(textoRevision(estadoRevision(en(0), ahora)), "vence hoy");
});

test("pasada la fecha: vencida, y dice hace cuánto", () => {
    assert.deepEqual(estadoRevision(new Date(ahora.getTime() - 3_600_000), ahora), { estado: "vencida", dias: 0 });
    assert.equal(textoRevision(estadoRevision(new Date(ahora.getTime() - 3_600_000), ahora)), "vencida hoy");
    assert.deepEqual(estadoRevision(en(-1.5), ahora), { estado: "vencida", dias: 1 });
    assert.equal(textoRevision(estadoRevision(en(-4), ahora)), "vencida hace 4 días");
});

test("sin fecha o con una ilegible: vencida (pide que alguien la mire)", () => {
    assert.deepEqual(estadoRevision(null, ahora), { estado: "vencida", dias: 0 });
    assert.deepEqual(estadoRevision("no es fecha", ahora), { estado: "vencida", dias: 0 });
});

test("acepta la fecha como texto ISO, que es como viaja a la pantalla", () => {
    assert.deepEqual(estadoRevision(en(12).toISOString(), ahora), { estado: "al-dia", dias: 12 });
});
