import { test } from "node:test";
import assert from "node:assert/strict";
import { entrenar, normalizar, partesDeValidacion, puntuar } from "@/lib/zona-entrenable";

/** Azar con semilla: la prueba da siempre lo mismo. */
function azar(semilla: number) { let a = semilla; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const DIA = 86_400_000, T0 = Date.UTC(2026, 10, 1, 15);

/**
 * Un contenedor de mentira: la dimensión 0 es «de noche» (una diferencia grande que no dice nada
 * del estado) y la 1 es la que importa (chica). Los que avisan salen casi todos de noche, como en
 * el lab: el promedio de cada estado carga con el día y la noche.
 */
function muestras(n: number, semilla: number, dias = 6) {
    const r = azar(semilla), out: { v: Float32Array; y: 0 | 1; t: number }[] = [];
    for (let k = 0; k < n; k++) {
        const y = (k % 3 === 0 ? 1 : 0) as 0 | 1, noche = r() < (y ? 0.8 : 0.2);
        const v = new Float32Array(24);
        for (let i = 0; i < 24; i++) v[i] = (r() - 0.5) * 0.2;
        v[0] += noche ? 0.8 : -0.8; v[1] += y ? 0.25 : -0.25; v[2] += 1;
        out.push({ v: normalizar(v), y, t: T0 + (k % dias) * DIA + k * 60_000 });
    }
    return out;
}

test("con muchos ejemplos gana la logística: aprende que el día y la noche no dicen nada del estado", async () => {
    const m = await entrenar(muestras(360, 7), 0.6, "prueba");
    assert.equal(m.metodo, "logistica");
    assert.equal(m.validacion, "dias");
    assert.ok(m.exactitud! > 0.93, `acierto ${m.exactitud}`);
    // Y el modelo guardado decide con la cuenta de siempre (la del worker): uno nuevo de cada estado, de día.
    const nuevo = (y: number) => { const v = new Float32Array(24); v[0] = -0.8; v[1] = y ? 0.25 : -0.25; v[2] = 1; return normalizar(v); };
    assert.ok(puntuar(m, nuevo(1))! > 0.6 && puntuar(m, nuevo(0))! < 0.4, `${puntuar(m, nuevo(1))} / ${puntuar(m, nuevo(0))}`);
});

test("con pocos ejemplos no se prueba la logística: quedan los prototipos", async () => {
    const m = await entrenar(muestras(48, 3), 0.6, null);
    assert.equal(m.metodo, "prototipos");
    assert.equal(m.n.pos + m.n.neg, 48);
});

test("la validación deja afuera días ENTEROS: dos miradas del mismo día nunca quedan en partes distintas", () => {
    const e = muestras(120, 5);
    const r = partesDeValidacion(e);
    assert.equal(r.como, "dias");
    const deDia = new Map<number, number>();
    e.forEach((x, i) => { const d = Math.floor((x.t - 3 * 3600_000) / DIA); if (deDia.has(d)) assert.equal(r.parte[i], deDia.get(d)); else deDia.set(d, r.parte[i]); });
    assert.ok(r.partes >= 2 && r.partes <= 5);
});

test("con pocos días, tramos seguidos de tiempo; sin fechas, salteado como antes", () => {
    const dos = partesDeValidacion(muestras(60, 9, 2));
    assert.equal(dos.como, "tramos");
    const orden = muestras(60, 9, 2).map((x, i) => ({ t: x.t, p: dos.parte[i] })).sort((a, b) => a.t - b.t).map((x) => x.p);
    assert.deepEqual(orden, [...orden].sort((a, b) => a - b), "cada tramo es un pedazo seguido de tiempo");
    assert.equal(partesDeValidacion(muestras(60, 9).map((x) => ({ y: x.y }))).como, "mezclada");
});

test("si los que avisan son todos de un mismo día, igual se puede entrenar y medir", async () => {
    const e = muestras(200, 11).map((x, k) => ({ ...x, t: x.y ? T0 + k * 60_000 : T0 + (1 + (k % 5)) * DIA + k * 60_000 }));
    const m = await entrenar(e, 0.6, null);
    assert.ok(m.exactitud != null && m.matriz != null);
});
