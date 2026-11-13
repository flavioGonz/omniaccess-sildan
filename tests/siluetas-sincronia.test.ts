/** Las siluetas a la hora del video (lib/siluetas-sincronia): qué análisis se muestra y cuándo no se muestra ninguno. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { colaDeSiluetas, ritmoParaAtraso, primerDatoDeVideo, relojDeAtraso, ADELANTO_MS, HUECO_MS, RITMO_AL_DIA, RITMO_APURADO } from "@/lib/siluetas-sincronia";

/** El navegador va 5 s adelantado respecto del servidor y la red tarda 40 ms: lo normal es que los relojes no coincidan. */
const DESFASE = 5000, RED = 40;
/** Diez análisis por segundo durante `seg` segundos, desde la hora de servidor `t0`. Cada uno tarda 60 ms en salir. */
function llenar(c: ReturnType<typeof colaDeSiluetas<number>>, t0: number, seg: number) {
    for (let t = t0; t < t0 + seg * 1000; t += 100) c.llegar(t, 60, t, t + 60 + DESFASE + RED);
}

test("con el video 3 s atrás, se muestra el análisis de hace 3 s y no el último", () => {
    const c = colaDeSiluetas<number>(); llenar(c, 100_000, 6);
    const ahoraServidor = 106_000, ahora = ahoraServidor + DESFASE + RED;
    const e = c.elegir(ahora, 3000)!;
    // El instante del video es 103 000 (más el adelanto): el análisis elegido es de ahí, no de 105 900.
    assert.ok(Math.abs(e.dato - (103_000 + ADELANTO_MS)) <= 100, `eligió ${e.dato}`);
    assert.ok(e.distancia >= 0 && e.distancia < 100);
});

test("sin saber el colchón del video se muestra lo último, como antes", () => {
    const c = colaDeSiluetas<number>(); llenar(c, 100_000, 3);
    assert.equal(c.elegir(102_950 + DESFASE + RED, null)!.dato, 102_900);
});

test("si el análisis se cortó, la silueta se va: no queda dibujada sobre una calle vacía", () => {
    const c = colaDeSiluetas<number>(); llenar(c, 100_000, 3); // el último es de 102 900
    const cuando = (ms: number) => c.elegir(ms + DESFASE + RED, 1000);
    assert.ok(cuando(103_800), "con 1 s de colchón, a los 103 800 todavía se está mostrando lo de 102 900");
    assert.equal(cuando(103_900 + HUECO_MS + 200), null, "pasado el hueco, nada");
});

test("el desfase entre relojes se toma del mensaje con menos demora de red", () => {
    const c = colaDeSiluetas<number>();
    c.llegar(1000, 50, 1, 1000 + 50 + DESFASE + 300); // un mensaje lento
    c.llegar(1100, 50, 2, 1100 + 50 + DESFASE + RED);
    c.llegar(1200, 50, 3, 1200 + 50 + DESFASE + 900); // otro, peor
    assert.equal(c.desfase, DESFASE + RED);
});

test("la cola no crece: guarda unos segundos y nada más (el vivo puede quedar horas abierto)", () => {
    const c = colaDeSiluetas<number>(); llenar(c, 0, 3600);
    assert.ok(c.largo <= 125, `quedaron ${c.largo}`);
});

test("un colchón disparatado no rompe nada: se acota a lo que hay guardado", () => {
    const c = colaDeSiluetas<number>(); llenar(c, 100_000, 12);
    assert.doesNotThrow(() => c.elegir(112_000 + DESFASE, 600_000));
    assert.equal(colaDeSiluetas<number>().elegir(1, 0), null, "sin análisis, nada");
});

test("el video se pone al día acelerando lo que atrasa de más; muy atrás, se abre de nuevo", () => {
    assert.equal(ritmoParaAtraso(0.1, 1), 1);
    assert.equal(ritmoParaAtraso(1.5, 1), RITMO_AL_DIA);
    assert.equal(ritmoParaAtraso(0.3, RITMO_AL_DIA), RITMO_AL_DIA, "en el medio sigue acelerado hasta llegar");
    assert.equal(ritmoParaAtraso(0.3, RITMO_APURADO), RITMO_AL_DIA);
    assert.equal(ritmoParaAtraso(0.3, 1), 1, "y no acelera por pasarse apenas");
    assert.equal(ritmoParaAtraso(0.1, RITMO_AL_DIA), 1);
    assert.equal(ritmoParaAtraso(5, 1), RITMO_APURADO);
    assert.equal(ritmoParaAtraso(20, 1), null, "muy atrás: se abre de nuevo, que arranca en el presente");
});

/** Cuadros a 25 por segundo: el de la hora de video `v0 + i·40 ms` se muestra a `t0 + i·40 + atraso(i)` (ms de pared). */
function mostrar(r: ReturnType<typeof relojDeAtraso>, t0: number, cuantos: number, atraso: (i: number) => number, v0 = 0) {
    for (let i = 0; i < cuantos; i++) r.cuadro(t0 + i * 40 + atraso(i), v0 + i * 0.04);
    return t0 + (cuantos - 1) * 40 + atraso(cuantos - 1);
}

test("sin la hora del primer dato no se inventa el atraso total, pero sí se sabe lo que sobra", () => {
    const r = relojDeAtraso(); const t = mostrar(r, 5000, 50, () => 0);
    assert.equal(r.atrasoMs(t), null);
    assert.equal(r.sobraMs(t), 0);
    assert.equal(r.sobraMs(mostrar(r, 7000, 25, (i) => Math.min(1500, i * 300), 2)), 1500);
});

test("el atraso sale de los cuadros que se presentan: el colchón de arranque cuenta, pero no sobra", () => {
    const r = relojDeAtraso(); r.abrio(10_000);
    // El primer dato llegó a los 10 000 y el navegador empezó a mostrar 1,3 s después: ese es su colchón.
    const fin = mostrar(r, 10_000, 50, () => 1300);
    assert.equal(r.atrasoMs(fin), 1300);
    assert.equal(r.sobraMs(fin), 0, "con lo de arranque no se acelera");
});

test("un tirón de la red atrasa el video, y se sabe cuánto aunque el navegador no lo diga", () => {
    const r = relojDeAtraso(); r.abrio(0); mostrar(r, 0, 100, () => 1300);
    // El video sigue caminando (tenía colchón) pero lo nuevo llega 2 s tarde: de ahí en más se muestra 2 s más atrás.
    const fin = mostrar(r, 4000, 25, (i) => 1300 + Math.min(2000, i * 500), 4);
    assert.equal(r.atrasoMs(fin), 3300);
    assert.equal(r.sobraMs(fin), 2000, "esos 2 s son los que se recuperan acelerando");
});

test("un tirón con parada: se quedó sin datos, llegaron todos juntos y sigue más atrás — eso se recupera", () => {
    const r = relojDeAtraso(); r.abrio(0); const t = mostrar(r, 0, 100, () => 1300);
    assert.equal(r.atrasoMs(t + 1000), Infinity, "sin cuadros nuevos: detenido");
    assert.equal(r.sobraMs(t + 1000), null);
    // Tres segundos parado; retoma desde donde estaba: ahora 4,3 s atrás.
    const fin = mostrar(r, 4000, 30, () => 4300, 4);
    assert.equal(r.atrasoMs(fin), 4300);
    assert.equal(r.sobraMs(fin), 3000, "los 3 s del tirón sobran: están guardados y se recuperan");
});

test("si se quedó sin datos MIENTRAS se aceleraba, se le gastó el colchón: no se lo persigue más", () => {
    const r = relojDeAtraso(); r.abrio(0); mostrar(r, 0, 100, () => 1300);
    r.ritmo(1.12);
    // Acelerado bajó a 0,6 s y se quedó sin datos; el navegador juntó de nuevo y retomó 1,5 s atrás.
    mostrar(r, 4000, 50, (i) => 1300 - i * 14, 4);
    const fin = mostrar(r, 6000, 30, () => 1500 + 1300, 6 + 1.3);
    assert.equal(r.sobraMs(fin), 0, "ese nivel es el nuevo arranque");
});

test("la hora del primer dato puede llegar después de los primeros cuadros: se corre todo, y lo que sobra no cambia", () => {
    const r = relojDeAtraso(); const t = mostrar(r, 2000, 30, () => 0); // empezó a mostrar a los 2000
    assert.equal(r.atrasoMs(t), null);
    r.abrio(500); // …pero el primer dato había llegado a los 500
    const fin = mostrar(r, 3200, 10, () => 0, 1.2);
    assert.equal(r.atrasoMs(fin), 1500);
    assert.equal(r.sobraMs(fin), 0);
});

test("el atraso nunca es negativo: si el reloj de la cámara adelanta, se corrige la base", () => {
    const r = relojDeAtraso(); r.abrio(1000);
    const fin = mostrar(r, 1000, 40, (i) => 300 - i * 20); // cuadros cada vez «antes de tiempo»
    assert.ok(r.atrasoMs(fin)! >= 0);
});

test("conexión nueva: se empieza de cero", () => {
    const r = relojDeAtraso(); r.abrio(0); mostrar(r, 0, 100, () => 0); r.reiniciar();
    assert.equal(r.atrasoMs(5000), null); assert.equal(r.sobraMs(5000), null);
});

test("con el video detenido no se dibuja nada: las siluetas seguirían caminando sobre un cuadro quieto", () => {
    const c = colaDeSiluetas<number>(); llenar(c, 100_000, 3);
    assert.equal(c.elegir(102_950 + DESFASE + RED, Infinity), null);
    assert.ok(c.elegir(102_950 + DESFASE + RED, 800), "y vuelven apenas el video camina");
});

test("el primer cuadro de un MP4 en vivo es su primera caja moof, aunque llegue partida en pedazos", async () => {
    const caja = (nombre: string, cuerpo: number) => { const b = new Uint8Array(8 + cuerpo); new DataView(b.buffer).setUint32(0, 8 + cuerpo); for (let i = 0; i < 4; i++) b[4 + i] = nombre.charCodeAt(i); return b; };
    const todo = [caja("ftyp", 20), caja("moov", 700), caja("moof", 100), caja("mdat", 5000)];
    const bytes = new Uint8Array(todo.reduce((n, b) => n + b.length, 0)); let o = 0; for (const b of todo) { bytes.set(b, o); o += b.length; }
    // En pedazos de 37 bytes, con el reloj avanzando 10 ms por pedazo: el moof empieza en el byte 736.
    let reloj = 0;
    const cuerpo = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < bytes.length; i += 37) c.enqueue(bytes.slice(i, i + 37)); c.close(); } });
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(cuerpo)) as typeof fetch;
    try {
        // Cada lectura es un pedazo; la hora se pide una sola vez, al ver el moof.
        const t = await primerDatoDeVideo("x", new AbortController().signal, () => ++reloj);
        assert.equal(t, 1);
        globalThis.fetch = (async () => new Response(new Uint8Array([0, 0, 0, 0, 1, 2, 3, 4]))) as typeof fetch;
        assert.equal(await primerDatoDeVideo("x", new AbortController().signal), null, "si no es un MP4, no se inventa");
    } finally { globalThis.fetch = original; }
});

test("una parada de la red mientras se aceleraba (todavía sobraba mucho) se sigue persiguiendo; y si acelerar no sirve, se acepta", () => {
    const r = relojDeAtraso(); r.abrio(0); mostrar(r, 0, 100, () => 1300);
    // Un tirón lo dejó 2 s atrás; se acelera y, cuando todavía sobran 1,5 s, otra parada de 3 s.
    mostrar(r, 4000, 25, (i) => 1300 + Math.min(2000, i * 500), 4); r.ritmo(1.12);
    mostrar(r, 5000, 25, (i) => 3300 - i * 20, 5);
    const fin = mostrar(r, 6000, 30, () => 2820 + 3000, 6);
    assert.equal(r.sobraMs(fin), 4520, "no se da por perdido");
    r.aceptar();
    assert.equal(r.sobraMs(fin), 0);
});
