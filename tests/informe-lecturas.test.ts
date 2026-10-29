/** El informe de Lecturas de cámara (lib/informes/lecturas-resumen): las cuentas que dibujan el PDF y el Excel. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { armarInforme, compararVision } from "@/lib/informes/lecturas-resumen";
import type { FilaLectura } from "@/lib/lecturas-camara";

const vis = (plate: string | null, estado = "LEIDA") => ({ plate, estado, confianza: 0.9, recorte: null, chapa: null, otras: [] });
const ev = (plate: string, v: any = null, ms = 500) => ({ id: plate + ms, ts: new Date(Date.parse("2026-10-28T13:00:00Z") + ms).toISOString(), plate, decision: "GRANT", sentido: "ENTRY", foto: null, chapaCamara: null, vision: v });
const fila = (estado: FilaLectura["estado"], cam: string | null, eventos: any[], variantes: string[] = [], deviceId = "c1"): FilaLectura => ({
    id: Math.random().toString(36), ts: "2026-10-28T13:00:00.000Z", hasta: "2026-10-28T13:00:02.000Z", deviceId, camara: deviceId === "c1" ? "LPR Entrada" : "LPR Salida",
    cam: estado === "solo" ? null : { plate: cam, variantes: [...(cam ? [{ plate: cam, veces: 3 }] : []), ...variantes.map((p) => ({ plate: p, veces: 1 }))], capturas: 4, sinLeer: cam ? 0 : 4, pais: null, sentido: "forward" },
    eventos, estado,
});

test("informe: OmniVision frente a la cámara", () => {
    assert.equal(compararVision(fila("coincide", "SBF2974", []), ev("SBF2974", vis("SBF2974"))), "coincide");
    assert.equal(compararVision(fila("variante", "MAI4301", [], ["AI4301"]), ev("AI4301", vis("AI4301"))), "variante");
    assert.equal(compararVision(fila("coincide", null, []), ev("NO_LEIDA", vis("SAB1234"))), "rescate");
    assert.equal(compararVision(fila("coincide", "SBF2974", []), ev("SBF2974", vis("SBF2971"))), "distinta");
    assert.equal(compararVision(fila("coincide", "SBF2974", []), ev("SBF2974", vis(null, "NO_LEIDA"))), "no-leyo");
    assert.equal(compararVision(fila("solo", null, []), ev("SBF2974", vis("SBF2974"))), "sin-camara");
    assert.equal(compararVision(fila("coincide", "SBF2974", []), ev("SBF2974")), null);
});

test("informe: totales, por cámara, acierto de OmniVision y casos", () => {
    const filas = [
        fila("coincide", "AAA1111", [ev("AAA1111", vis("AAA1111"))]),
        fila("coincide", "BBB2222", [ev("BBB2222", vis("BBB2229"))]),
        fila("variante", "MAI4301", [ev("AI4301")], ["AI4301"]),
        fila("perdida", "CCC3333", [], [], "c2"),
        fila("distinta", "DDD4444", [ev("XXX9999")], [], "c2"),
        fila("solo", null, [ev("EEE5555")]),
    ];
    const inf = armarInforme(filas, [{ id: "c1", nombre: "LPR Entrada" }, { id: "c2", nombre: "LPR Salida" }]);
    assert.equal(inf.total.pasos, 5);              // «sólo OmniAccess» no es un vehículo que leyó la cámara
    assert.equal(inf.total.bien, 3);
    assert.equal(inf.total.perdida, 1);
    assert.equal(inf.total.solo, 1);
    assert.equal(inf.total.vision.total, 2);
    assert.equal(inf.total.vision.aciertoPct, 0.5);
    assert.deepEqual(inf.camaras.map((c) => [c.nombre, c.m.pasos]), [["LPR Entrada", 3], ["LPR Salida", 2]]);
    assert.deepEqual(inf.casos.map((c) => c.motivo).sort(), ["distinta", "perdida", "vision-distinta"]);
    assert.equal(inf.porHora.length, 24);
    assert.ok(inf.hallazgos.some((h) => h.includes("No llegaron 1")));
});

test("informe: sin lecturas lo dice", () => {
    const inf = armarInforme([], []);
    assert.deepEqual(inf.hallazgos, ["No hay lecturas registradas en el período elegido."]);
});

test("informe: NO_LEIDA no es una chapa (ni con guion bajo ni normalizada)", async () => {
    const { chapaNorm } = await import("@/lib/informes/lecturas-resumen");
    for (const x of ["NO_LEIDA", "NOLEIDA", "unknown", "S/P", "", null]) assert.equal(chapaNorm(x as any), null, String(x));
    assert.equal(chapaNorm("sbf-2974"), "SBF2974");
});
