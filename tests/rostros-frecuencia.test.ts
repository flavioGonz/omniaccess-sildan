/** La frecuencia de una cara (lib/rostros-frecuencia): visitas, días, franja, y cuándo se sugiere registrarla. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { frecuencia, visitasDe, VISITA_MS, SUGERIR, TIRA_DIAS } from "@/lib/rostros-frecuencia";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const R = require("../lib-rostros.js");

const AHORA = new Date("2026-11-13T15:00:00-03:00").getTime();
/** Un instante: tantos días atrás, a tal hora de Montevideo. */
const el = (diasAtras: number, hora: number, min = 0) => new Date(`2026-11-${String(13 - diasAtras).padStart(2, "0")}T${String(hora).padStart(2, "0")}:${String(min).padStart(2, "0")}:00-03:00`).getTime();

test("la visita se corta igual que en el proceso de visión", () => {
    assert.equal(VISITA_MS, R.VISITA_MS);
    // Tres pasadas en ocho minutos (cruzó dos cámaras y volvió) son una visita; la de la tarde, otra.
    const v = visitasDe([{ cuando: el(0, 7, 0) }, { cuando: el(0, 7, 4) }, { cuando: el(0, 7, 8) }, { cuando: el(0, 13, 30) }]);
    assert.equal(v.length, 2);
});

test("el que entra y sale todo un día no es todavía de la casa: no se sugiere", () => {
    const pasadas = [7, 8, 9, 10, 11, 12, 13, 14].map((h) => ({ cuando: el(0, h), camara: "Entrada" }));
    const f = frecuencia(pasadas, { ahora: AHORA });
    assert.equal(f.visitas, 8);
    assert.equal(f.dias, 1);
    assert.equal(f.conviene, false, "ocho visitas pero un solo día");
    assert.equal(f.patron, "ocasional");
    assert.match(f.texto, /8 visitas en un mismo día/);
});

test("vino tres días en dos semanas: se sugiere registrarla, y se dice cuándo y por dónde", () => {
    const pasadas = [{ cuando: el(9, 7, 10), camara: "Entrada Proveedores" }, { cuando: el(5, 7, 40), camara: "Entrada Proveedores" }, { cuando: el(1, 8, 5), camara: "Entrada Proveedores" }];
    const f = frecuencia(pasadas, { ahora: AHORA });
    assert.equal(f.visitas14, 3);
    assert.equal(f.dias14, 3);
    assert.equal(f.conviene, true);
    assert.equal(f.patron, "recurrente");
    assert.deepEqual(f.franja, { desde: 7, hasta: 9 });
    assert.equal(f.texto, "3 visitas en 3 días · casi siempre de 07 a 09 h · siempre por Entrada Proveedores");
    assert.ok(SUGERIR.dias >= 2, "con un solo día no alcanza: ver la prueba de arriba");
});

test("a quien ya tiene nombre no se le sugiere nada, aunque sea habitual", () => {
    const pasadas = [6, 5, 4, 3, 2, 1].map((d) => ({ cuando: el(d, 18, 30), camara: "Portón" }));
    const f = frecuencia(pasadas, { ahora: AHORA, registrada: true });
    assert.equal(f.patron, "habitual");
    assert.equal(f.conviene, false);
});

test("sin costumbre no se inventa una franja", () => {
    const f = frecuencia([{ cuando: el(6, 3) }, { cuando: el(4, 11) }, { cuando: el(2, 19) }, { cuando: el(1, 23) }], { ahora: AHORA });
    assert.equal(f.franja, null);
    assert.doesNotMatch(f.texto, /casi siempre/);
});

test("lo viejo no cuenta para sugerir: tres visitas de hace un mes no son «viene seguido»", () => {
    const viejo = (d: number) => AHORA - d * 86_400_000;
    const f = frecuencia([{ cuando: viejo(25) }, { cuando: viejo(24) }, { cuando: viejo(22) }], { ahora: AHORA });
    assert.equal(f.visitas, 3);
    assert.equal(f.visitas14, 0);
    assert.equal(f.conviene, false);
});

test("una cara de hoy con una sola pasada es nueva; sin pasadas en la ventana, lo dice", () => {
    assert.equal(frecuencia([{ cuando: el(0, 9) }], { ahora: AHORA }).patron, "nueva");
    const nada = frecuencia([], { ahora: AHORA, primeraVez: AHORA - 40 * 86_400_000 });
    assert.equal(nada.visitas, 0);
    assert.equal(nada.patron, "ocasional");
    assert.match(nada.texto, /Sin visitas/);
});

test("la tira: una casilla por día, hoy al final", () => {
    const f = frecuencia([{ cuando: el(0, 9) }, { cuando: el(0, 12) }, { cuando: el(3, 9) }], { ahora: AHORA });
    assert.equal(f.tira.length, TIRA_DIAS);
    assert.equal(f.tira[TIRA_DIAS - 1], 2);
    assert.equal(f.tira[TIRA_DIAS - 4], 1);
    assert.equal(f.tira.reduce((a, b) => a + b, 0), 3);
});

/* ── Lo que se guarda al ajustar el motor, y el detalle de un acceso al que se le dio identidad a mano ── */
import { normalizarAjustesRostros } from "@/lib/rostros";
import { detallesConIdentidad, leerDetalleRostro } from "@/lib/monitor/rostro";

const BASE = { misma: 0.8, parecida: 0.65, padron: 0.89, pxMin: 80, anonimosDias: 30 };

test("los ajustes se guardan dentro de sus límites y sin tocar lo que no vino", () => {
    const { ajustes, avisos } = normalizarAjustesRostros({ misma: 0.86, pxMin: 5 }, BASE);
    assert.deepEqual(ajustes, { misma: 0.86, parecida: 0.65, padron: 0.89, pxMin: 30, anonimosDias: 30 });
    assert.equal(avisos.length, 0);
    assert.equal(normalizarAjustesRostros({ misma: 2, padron: Number.NaN as number }, BASE).ajustes.misma, 0.99);
    assert.equal(normalizarAjustesRostros({ padron: "x" as unknown as number }, BASE).ajustes.padron, 0.89);
});

test("«se parece» nunca queda por encima de «misma persona», y se avisa", () => {
    const { ajustes, avisos } = normalizarAjustesRostros({ misma: 0.7, parecida: 0.9 }, BASE);
    assert.equal(ajustes.parecida, 0.7);
    assert.equal(avisos.length, 1);
    // Lo que acepta el proceso de visión con esos mismos números.
    assert.deepEqual({ misma: R.umbrales(ajustes).misma, parecida: R.umbrales(ajustes).parecida }, { misma: 0.7, parecida: 0.7 });
});

test("darle identidad a mano a una pasada: cambia quién es, conserva la foto y la calidad", () => {
    const antes = "Rostro: Desconocido, FaceImage: /api/vision/imagen/2026-11-13/abc-cara.jpg, Deteccion: 100%, CaraFrac: 18, CaraPx: 62, Identidad: sin-cara, SinIdentidad: cara chica (62 px), CaraCaja: 0.586-0.38-0.605-0.412, Escena: /api/vision/imagen/2026-11-13/abc-e.jpg, Source: OmniVision";
    const d = leerDetalleRostro(detallesConIdentidad(antes, { rostroId: "r0123abc", nombre: "R-0004", veces: 1 }));
    assert.equal(d.nombre, "R-0004");
    assert.equal(d.rostroId, "r0123abc");
    assert.equal(d.identidad, "nueva");
    assert.equal(d.sinIdentidad, null);
    assert.equal(d.veces, 1);
    assert.equal(d.caraPx, 62);
    assert.equal(d.recorte, "/api/vision/imagen/2026-11-13/abc-cara.jpg");
    assert.deepEqual(d.caja, [0.586, 0.38, 0.605, 0.412]);
    assert.equal(d.escena, "/api/vision/imagen/2026-11-13/abc-e.jpg");
    assert.match(detallesConIdentidad(antes, { rostroId: "r1", nombre: "Pérez, Ana", veces: 2 }), /^Rostro: Pérez  Ana, /);
});

/* ── El piso para agregar a mano, y qué se dice de cada cámara ── */
import { pisoManual, veredictoCamara } from "@/lib/rostros";

test("a mano se puede agregar hasta la mitad del mínimo; más chica, no", () => {
    assert.equal(pisoManual(80), 40);
    assert.equal(pisoManual(100), 50);
});

test("de una cámara se opina con datos: si ninguna cara alcanzó, se avisa; con pocas, sólo se cuenta", () => {
    // Lo que dio una cámara de escena del lab el 13/11: nueve caras de 16 a 19 px, ninguna con identidad.
    assert.deepEqual(veredictoCamara({ deviceId: "a", pasadas: 9, conIdentidad: 0, pxMediana: 17 }, 80), { tono: "aviso", texto: "9 caras · mediana 17 px · ninguna alcanzó los 80 px" });
    assert.deepEqual(veredictoCamara({ deviceId: "b", pasadas: 12, conIdentidad: 9, pxMediana: 131 }, 80), { tono: "bien", texto: "12 caras · mediana 131 px · 9 con identidad" });
    assert.equal(veredictoCamara({ deviceId: "c", pasadas: 2, conIdentidad: 0, pxMediana: 30 }, 80)?.tono, "quieto", "con dos caras no se opina");
    assert.equal(veredictoCamara(undefined, 80), null);
    assert.equal(veredictoCamara({ deviceId: "d", pasadas: 0, conIdentidad: 0, pxMediana: null }, 80), null);
});
