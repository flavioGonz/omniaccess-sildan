/** Una matrícula confirmada como requerida por el Ministerio: cómo se la reconoce y qué queda escrito (lib/min-interior). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ETIQUETA_REQUERIDA, esRequerida, motivoRequerida, confirmacionDe, motivoALaVista } from "@/lib/min-interior";

const CUANDO = new Date("2026-11-13T17:16:00-03:00");

test("el motivo dice qué, cuándo se confirmó y quién; y conserva lo que la lista ya decía", () => {
    assert.equal(motivoRequerida(CUANDO, "Admin User"), "Requerida por el Ministerio del Interior. Confirmada en el sitio oficial el 13/11/2026 a las 17:16 por Admin User.");
    assert.equal(motivoRequerida(CUANDO, null, "Sospechoso: marcado desde el vivo de Ext. Cairoli."),
        "Requerida por el Ministerio del Interior. Confirmada en el sitio oficial el 13/11/2026 a las 17:16. Antes en la lista: Sospechoso: marcado desde el vivo de Ext. Cairoli.");
});

test("volver a confirmarla no encadena motivos: el anterior de requerida no se arrastra", () => {
    const uno = motivoRequerida(CUANDO, "Ana");
    const dos = motivoRequerida(new Date("2026-11-14T09:00:00-03:00"), "Luis", uno);
    assert.equal(dos, "Requerida por el Ministerio del Interior. Confirmada en el sitio oficial el 14/11/2026 a las 09:00 por Luis.");
});

test("se la reconoce por la etiqueta o por el motivo, y del motivo sale la fecha del cartel", () => {
    const motivo = motivoRequerida(CUANDO, "Ana");
    assert.equal(esRequerida(ETIQUETA_REQUERIDA, null), true);
    assert.equal(esRequerida("otra cosa", motivo), true);
    assert.equal(esRequerida("Lista negra", "Robó en el lote 12"), false);
    assert.equal(esRequerida(null, null), false);
    assert.equal(confirmacionDe(motivo), "13/11/2026 17:16");
    assert.equal(confirmacionDe("Robó en el lote 12"), null);
});

test("a la vista: el aviso dice quién la requiere, cuándo se confirmó y en qué cámara", () => {
    const motivo = motivoRequerida(CUANDO, "Admin User");
    assert.equal(motivoALaVista({ requerida: true, etiqueta: ETIQUETA_REQUERIDA, motivo }, "Ext. Cairoli"),
        "Requerida por el Ministerio del Interior (confirmada el 13/11/2026 17:16). A la vista en Ext. Cairoli.");
    // Una requerida cargada a mano, sin la fecha en el motivo: no se inventa una.
    assert.equal(motivoALaVista({ requerida: true, etiqueta: ETIQUETA_REQUERIDA, motivo: null }, null),
        "Requerida por el Ministerio del Interior. A la vista en una cámara de seguimiento.");
    assert.equal(motivoALaVista({ requerida: false, etiqueta: "Robo en el lote 12", motivo: null }, "Calle 21"),
        "En la lista negra: Robo en el lote 12. A la vista en Calle 21.");
});
