/** Cuándo llegó un vehículo a su lugar (lib/vision-llegada): qué hace cada pista y dónde se corta la búsqueda hacia atrás. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { enElLugar, papelDe, instanteDeLlegada, buscadorDeLlegada, grabacionDesde, avisoDeLlegada, ANTES_DE, HUECO_MS, MISMO_VEHICULO, type PistaLugar } from "@/lib/vision-llegada";

// Un lugar del lab (13/11): la caja del auto y su punto de apoyo, el medio del borde de abajo.
const LUGAR = [0.274, 0.473, 0.472, 0.638];
const APOYO = [0.373, 0.638];
const MIN = 60_000, AHORA = Date.UTC(2026, 10, 13, 18, 0, 0), RELOJ = AHORA - 40 * MIN;
/** Una pista quieta en el lugar, de un cuadro (como las que deja un auto estacionado). */
const quieta = (hace: number, parecido: number | null = 0.97): PistaLugar => ({ desde: AHORA - hace, hasta: AHORA - hace, recorrido: [[APOYO[0] + 0.002, APOYO[1] - 0.001, 0]], parecido });
const nadie = () => false, siempre = () => true;

test("el punto de apoyo: en el lugar, por detrás, por delante y al costado", () => {
    assert.equal(enElLugar(APOYO, LUGAR), true);
    assert.equal(enElLugar([APOYO[0], APOYO[1] - 0.06], LUGAR), false, "un auto que pasa por detrás apoya más arriba");
    assert.equal(enElLugar([APOYO[0], APOYO[1] + 0.06], LUGAR), false, "uno que pasa por delante, más abajo");
    assert.equal(enElLugar([APOYO[0] + 0.1, APOYO[1]], LUGAR), false, "el del lugar de al lado");
});

test("qué hizo cada pista: llega, está quieta, se va, o no tiene que ver", () => {
    const entra: PistaLugar = { desde: 0, hasta: 12_000, recorrido: [[0.9, 0.9, 0], [0.7, 0.8, 4], [0.5, 0.7, 8], [0.38, 0.64, 10], [0.373, 0.638, 12]] };
    assert.equal(papelDe(entra, LUGAR), "llega");
    assert.equal(instanteDeLlegada(entra, LUGAR), 10_000, "el primer punto desde el que ya no salió");
    assert.equal(papelDe({ desde: 0, hasta: 8000, recorrido: [[0.373, 0.638, 0], [0.5, 0.7, 4], [0.9, 0.9, 8]] }, LUGAR), "se-va");
    assert.equal(papelDe(quieta(0), LUGAR), "quieta");
    assert.equal(papelDe({ desde: 0, hasta: 0, recorrido: [[0.9, 0.2, 0]] }, LUGAR), "ajena");
    // Una caja que tiembla (empieza en el lugar y termina apenas corrida) no es un auto que se va.
    assert.notEqual(papelDe({ desde: 0, hasta: 4000, recorrido: [[0.373, 0.638, 0], [0.373 + 0.198 * 0.4, 0.638, 4]] }, LUGAR), "se-va");
    assert.equal(papelDe({ desde: 0, hasta: 0, recorrido: [] }, LUGAR), "ajena");
});

test("sin nada anterior en el registro, lo que vale es la hora del reloj, y se abre apenas antes", async () => {
    const b = buscadorDeLlegada(LUGAR, { ahora: AHORA, reloj: RELOJ, huboOtraCosa: siempre });
    // Sólo hay pistas de después del reloj: no dicen nada de cómo llegó.
    assert.equal(await b.sumar([quieta(5 * MIN), quieta(20 * MIN)]), null);
    const r = b.cerrar(AHORA - 7 * 86_400_000);
    assert.deepEqual({ ms: r.ms, como: r.como }, { ms: RELOJ, como: "reloj" });
    assert.equal(grabacionDesde(r), RELOJ - ANTES_DE.reloj);
    assert.ok(ANTES_DE.reloj <= 15_000, "con 90 s se veía un minuto y medio de calle vacía: de eso fue la queja");
    assert.equal(avisoDeLlegada(r, String), null);
});

test("el reloj se había reiniciado: las pistas quietas de antes, del MISMO auto, llevan más atrás", async () => {
    const b = buscadorDeLlegada(LUGAR, { ahora: AHORA, reloj: RELOJ, huboOtraCosa: siempre });
    // Quieto ahí cada 2 o 3 minutos desde 70 minutos atrás; antes, nada.
    const pistas = [42, 45, 47, 50, 53, 55, 58, 61, 64, 66, 70].map((m) => quieta(m * MIN));
    assert.equal(await b.sumar(pistas), null);
    const r = b.cerrar(AHORA - 7 * 86_400_000);
    assert.deepEqual({ ms: r.ms, como: r.como }, { ms: AHORA - 70 * MIN, como: "primera-vez" });
    assert.equal(grabacionDesde(r), AHORA - 70 * MIN - ANTES_DE["primera-vez"]);
    assert.match(avisoDeLlegada(r, () => "16:50") || "", /desde las 16:50/);
});

test("nunca se contesta una hora posterior a la del reloj", async () => {
    const b = buscadorDeLlegada(LUGAR, { ahora: AHORA, reloj: RELOJ, huboOtraCosa: siempre });
    // El registro tiene un bache: su pista más vieja de este lugar es de hace 10 minutos.
    await b.sumar([quieta(2 * MIN), quieta(10 * MIN)]);
    assert.equal(b.cerrar(AHORA - 7 * 86_400_000).ms, RELOJ);
});

test("otro auto que estuvo antes en ese mismo lugar: ahí se corta", async () => {
    const b = buscadorDeLlegada(LUGAR, { ahora: AHORA, reloj: RELOJ, huboOtraCosa: nadie });
    const r = await b.sumar([quieta(42 * MIN), quieta(45 * MIN), quieta(48 * MIN, 0.81), quieta(51 * MIN, 0.80)]);
    assert.deepEqual({ ms: r?.ms, como: r?.como, corte: r?.corte }, { ms: AHORA - 45 * MIN, como: "primera-vez", corte: "otro-vehiculo" });
    assert.ok(0.81 < MISMO_VEHICULO && MISMO_VEHICULO < 0.966, "entre lo que se parecen dos autos distintos y uno consigo mismo (medido el 13/11)");
});

test("una pista sin huella no estira ni corta: no se sabe de quién es", async () => {
    const b = buscadorDeLlegada(LUGAR, { ahora: AHORA, reloj: RELOJ, huboOtraCosa: nadie });
    assert.equal(await b.sumar([quieta(42 * MIN, null), quieta(44 * MIN, null)]), null);
    assert.equal(b.cerrar(0).como, "reloj");
});

test("el anterior yéndose corta; un hueco largo corta sólo si la cámara siguió registrando", async () => {
    const seVa: PistaLugar = { desde: AHORA - 50 * MIN, hasta: AHORA - 50 * MIN + 8000, recorrido: [[0.373, 0.638, 0], [0.5, 0.7, 4], [0.9, 0.9, 8]], parecido: 0.6 };
    const a = await buscadorDeLlegada(LUGAR, { ahora: AHORA, reloj: RELOJ, huboOtraCosa: nadie }).sumar([quieta(43 * MIN), quieta(46 * MIN), seVa, quieta(52 * MIN)]);
    assert.deepEqual({ ms: a?.ms, corte: a?.corte }, { ms: AHORA - 46 * MIN, corte: "se-fue-el-anterior" });

    const conHueco = [quieta(43 * MIN), quieta(43 * MIN + HUECO_MS + 5 * MIN)];
    // La cámara registró otras cosas en el medio: el lugar estuvo sin él.
    const b = await buscadorDeLlegada(LUGAR, { ahora: AHORA, reloj: RELOJ, huboOtraCosa: siempre }).sumar(conHueco);
    assert.deepEqual({ ms: b?.ms, corte: b?.corte }, { ms: AHORA - 43 * MIN, corte: "hueco" });
    // La cámara no registró nada de nada (se cayó el video): no se sabe, se sigue.
    const c = buscadorDeLlegada(LUGAR, { ahora: AHORA, reloj: RELOJ, huboOtraCosa: nadie });
    assert.equal(await c.sumar(conHueco), null);
    assert.equal(c.inicio, AHORA - 43 * MIN - HUECO_MS - 5 * MIN);
});

test("si quedó la entrada, se abre cuando apareció en la escena (o unos segundos antes de que quedara)", async () => {
    const entra = (segundos: number): PistaLugar => ({ desde: RELOJ - segundos * 1000, hasta: RELOJ + 2000, parecido: 0.95,
        recorrido: [[0.9, 0.9, 0], [0.6, 0.75, Math.round(segundos / 2)], [0.373, 0.638, segundos], [0.373, 0.638, segundos + 2]] });
    const corta = await buscadorDeLlegada(LUGAR, { ahora: AHORA, reloj: RELOJ, huboOtraCosa: nadie }).sumar([entra(14)]);
    assert.deepEqual({ como: corta?.como, ms: corta?.ms }, { como: "llegada", ms: RELOJ });
    assert.equal(grabacionDesde(corta!), RELOJ - 14_000 - 2000, "tardó 14 s en acomodarse: se lo ve desde que aparece");
    const larga = await buscadorDeLlegada(LUGAR, { ahora: AHORA, reloj: RELOJ, huboOtraCosa: nadie }).sumar([entra(80)]);
    assert.equal(grabacionDesde(larga!), RELOJ - ANTES_DE.llegada, "dio vueltas más de un minuto: se abre poco antes de que quede en su lugar");
});
