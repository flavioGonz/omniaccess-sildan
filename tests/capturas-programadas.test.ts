/** Capturas programadas (openspec capturas-programadas-entrenamiento): cuándo toca, los frenos y qué es «repetida». */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    BLOQUE, CADA_MIN_MINIMO, CAMARAS_MAXIMO, COLA_MAXIMA, DIF_BLOQUE_MAX, DIF_MEDIA_MAX, HUELLA_ALTO, HUELLA_ANCHO, TOPE_MAXIMO,
    cadaCuanto, comparar, cupoDe, enFranja, esRepetida, proximaApertura, queHacer, validarPrograma,
} from "@/lib/capturas-programadas";

// 12/11/2026 15:00 en Uruguay (UTC-3).
const AHORA = new Date("2026-11-12T18:00:00.000Z");
const min = (n: number) => new Date(AHORA.getTime() + n * 60_000).toISOString();
const base = { activa: true, terminada: null, tope: 200, guardadas: 0, hasta: min(7 * 1440), horario: null, cadaMin: 30, proximaAt: min(-1), forzarAt: null };
const cola = { ahora: AHORA, sinDibujar: 0 };

test("le toca cuando llegó su hora, y espera cuando no", () => {
    assert.deepEqual(queHacer(base, cola), { que: "tomar", pedida: false });
    assert.deepEqual(queHacer({ ...base, proximaAt: min(10) }, cola), { que: "esperar", proxima: min(10) });
});

test("en pausa no toma, y conserva lo suyo", () => {
    assert.deepEqual(queHacer({ ...base, activa: false }, cola), { que: "pausada" });
    // «Tomar ahora» sobre una pausada tampoco: primero se reanuda.
    assert.deepEqual(queHacer({ ...base, activa: false, forzarAt: min(0) }, cola), { que: "pausada" });
});

test("termina por tope y por fecha, y eso gana sobre todo lo demás", () => {
    assert.deepEqual(queHacer({ ...base, guardadas: 200 }, cola), { que: "terminada", motivo: "tope" });
    assert.deepEqual(queHacer({ ...base, hasta: min(-1) }, cola), { que: "terminada", motivo: "fecha" });
    assert.deepEqual(queHacer({ ...base, guardadas: 200, activa: false, forzarAt: min(0) }, cola), { que: "terminada", motivo: "tope" });
    assert.equal(cupoDe({ tope: 200, guardadas: 198 }), 2);
    assert.equal(cupoDe({ tope: 200, guardadas: 230 }), 0);
});

test("con la cola llena espera, y sigue sola cuando baja", () => {
    assert.equal(queHacer(base, { ahora: AHORA, sinDibujar: COLA_MAXIMA }).que, "cola");
    assert.equal(queHacer(base, { ahora: AHORA, sinDibujar: COLA_MAXIMA - 1 }).que, "tomar");
    // «Tomar ahora» no pasa por encima de la cola: el freno es para no enterrar «Sin dibujar».
    assert.equal(queHacer({ ...base, forzarAt: min(0) }, { ahora: AHORA, sinDibujar: COLA_MAXIMA + 50 }).que, "cola");
});

test("«Tomar ahora» no espera la hora ni la franja", () => {
    assert.deepEqual(queHacer({ ...base, proximaAt: min(20), forzarAt: min(0) }, cola), { que: "tomar", pedida: true });
    assert.deepEqual(queHacer({ ...base, horario: { desde: "20:00", hasta: "06:00" }, forzarAt: min(0) }, cola), { que: "tomar", pedida: true });
});

test("la franja se mira en hora de Uruguay, también la que cruza medianoche", () => {
    const noche = { desde: "20:00", hasta: "06:00" };
    assert.equal(enFranja(noche, AHORA), false);                                  // 15:00
    assert.equal(enFranja(noche, new Date("2026-11-12T23:30:00.000Z")), true);   // 20:30
    assert.equal(enFranja(noche, new Date("2026-11-13T05:00:00.000Z")), true);   // 02:00
    assert.equal(enFranja(noche, new Date("2026-11-13T09:00:00.000Z")), false);  // 06:00 justo: ya cerró
    assert.equal(enFranja({ desde: "08:00", hasta: "18:00" }, AHORA), true);
    assert.equal(enFranja(null, AHORA), true);
    // Fuera de franja: dice cuándo abre (20:00 de Uruguay = 23:00 UTC) y no toma.
    assert.equal(proximaApertura(noche, AHORA).toISOString(), "2026-11-12T23:00:00.000Z");
    assert.deepEqual(queHacer({ ...base, horario: noche }, cola), { que: "franja", proxima: "2026-11-12T23:00:00.000Z" });
});

test("la validación dice qué está mal, en palabras", () => {
    const bien = { nombre: "Portería de noche", camaras: ["cam1", "nvrch-abc-3"], cadaMin: 30, horario: null, tope: 200, hasta: min(7 * 1440) };
    const v = validarPrograma(bien, AHORA);
    assert.ok("datos" in v && v.datos.camaras.length === 2);
    const mal = (x: object) => { const r = validarPrograma({ ...bien, ...x }, AHORA); return "error" in r ? r.error : null; };
    assert.match(mal({ cadaMin: CADA_MIN_MINIMO - 1 })!, /5 minutos a 24 horas/);
    assert.match(mal({ cadaMin: 1441 })!, /5 minutos a 24 horas/);
    assert.match(mal({ cadaMin: 7.5 })!, /5 minutos a 24 horas/);
    assert.match(mal({ camaras: [] })!, /al menos una cámara/);
    assert.match(mal({ camaras: Array.from({ length: CAMARAS_MAXIMO + 1 }, (_, i) => `c${i}`) })!, /Como mucho/);
    assert.match(mal({ tope: TOPE_MAXIMO + 1 })!, /tope/);
    assert.match(mal({ hasta: min(-5) })!, /ya pasó/);
    assert.match(mal({ hasta: min(400 * 1440) })!, /Como mucho 90 días/);
    assert.match(mal({ horario: { desde: "20:00", hasta: "20:00" } })!, /misma hora/);
    assert.match(mal({ horario: { desde: "8", hasta: "20:00" } })!, /HH:MM/);
    assert.match(mal({ nombre: "  " })!, /nombre/);
    // Cámaras repetidas cuentan una vez.
    const r = validarPrograma({ ...bien, camaras: ["cam1", "cam1"] }, AHORA);
    assert.ok("datos" in r && r.datos.camaras.length === 1);
});

/** Una escena de mentira: un degradé con algo de ruido fijo, para tener una huella con forma. */
function escena(): Uint8Array {
    const h = new Uint8Array(HUELLA_ANCHO * HUELLA_ALTO);
    for (let y = 0; y < HUELLA_ALTO; y++) for (let x = 0; x < HUELLA_ANCHO; x++) h[y * HUELLA_ANCHO + x] = 40 + x * 2 + ((x * 7 + y * 13) % 5);
    return h;
}

test("la misma escena con el ruido de la cámara es repetida", () => {
    const a = escena(), b = escena();
    // ±2 niveles en todo el cuadro: lo que se midió en una escena quieta de noche (media 0,4–2,4).
    for (let i = 0; i < b.length; i++) b[i] += (i % 3) - 1;
    const d = comparar(a, b)!;
    assert.ok(d.media < DIF_MEDIA_MAX && d.bloque < DIF_BLOQUE_MAX, JSON.stringify(d));
    assert.equal(esRepetida(d), true);
});

test("algo que aparece en un rincón no es repetida, aunque el promedio casi no se mueva", () => {
    const a = escena(), b = escena();
    // Un objeto de 6×4 celdas (unos 190×125 px en un cuadro de 1920), 60 niveles más claro.
    for (let y = 30; y < 34; y++) for (let x = 2; x < 8; x++) b[y * HUELLA_ANCHO + x] += 60;
    const d = comparar(a, b)!;
    assert.ok(d.media < DIF_MEDIA_MAX, `la media sola no lo ve: ${d.media}`);
    assert.ok(d.bloque >= DIF_BLOQUE_MAX, `el bloque sí: ${d.bloque}`);
    assert.equal(esRepetida(d), false);
});

test("el cambio de luz de todo el cuadro no es repetida", () => {
    const a = escena(), b = escena();
    for (let i = 0; i < b.length; i++) b[i] = Math.min(255, b[i] + 5);
    assert.equal(esRepetida(comparar(a, b)), false);
});

test("sin foto anterior, o con huellas de otro tamaño, nunca es repetida", () => {
    assert.equal(comparar(escena(), new Uint8Array(0)), null);
    assert.equal(esRepetida(null), false);
    assert.equal(esRepetida(comparar(escena(), new Uint8Array(32 * 18))), false);
    assert.ok(HUELLA_ALTO % BLOQUE === 0, "los bloques cubren el alto sin sobrantes");
});

test("cada cuánto, en palabras", () => {
    assert.equal(cadaCuanto(30), "cada 30 min");
    assert.equal(cadaCuanto(120), "cada 2 h");
    assert.equal(cadaCuanto(90), "cada 90 min");
    assert.equal(cadaCuanto(1440), "una vez por día");
});
