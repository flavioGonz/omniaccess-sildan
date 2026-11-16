import { test } from "node:test";
import assert from "node:assert/strict";
import { contradiceALaEstadia, memoriaDeChapas, INTENTOS_MAX, POR_VUELTA } from "@/lib/chapas-en-vivo";

const AUTO = [0.2, 0.3, 0.5, 0.7], CHAPA: [number, number, number, number] = [0.32, 0.6, 0.38, 0.63];

test("el recuadro sale con la primera chapa encontrada; el texto, recién con dos lecturas iguales", () => {
    const m = memoriaDeChapas();
    assert.deepEqual(m.pendientes([AUTO], 0), [AUTO]);
    assert.equal(m.de(AUTO), null);
    m.anotar(AUTO, { texto: "sbx 4521", confianza: 0.66, caja: CHAPA });
    assert.equal(m.de(AUTO)!.plate, "", "una sola lectura floja: se dibuja dónde está, no qué dice");
    assert.deepEqual(m.de(AUTO)!.caja.map((v) => +v.toFixed(3)), CHAPA);
    m.pendientes([AUTO], 1000); m.anotar(AUTO, { texto: "SBX4527", confianza: 0.7, caja: CHAPA });
    assert.equal(m.de(AUTO)!.plate, "", "dos lecturas distintas no confirman nada");
    m.pendientes([AUTO], 2000); m.anotar(AUTO, { texto: "SBX4521", confianza: 0.62, caja: CHAPA });
    assert.equal(m.de(AUTO)!.plate, "SBX4521");
    assert.deepEqual(m.pendientes([AUTO], 3000), [], "ya leído: no se le pide más");
});

test("una sola lectura muy segura alcanza; una de poca confianza o de largo raro no cuenta", () => {
    const m = memoriaDeChapas();
    m.pendientes([AUTO], 0);
    m.anotar(AUTO, { texto: "ABC1234", confianza: 0.5, caja: CHAPA }); m.anotar(AUTO, { texto: "ABC1234", confianza: 0.55, caja: CHAPA });
    m.anotar(AUTO, { texto: "AB12", confianza: 0.95, caja: CHAPA });
    assert.equal(m.de(AUTO)!.plate, "");
    m.anotar(AUTO, { texto: "ABC1234", confianza: 0.9, caja: CHAPA });
    assert.equal(m.de(AUTO)!.plate, "ABC1234");
});

test("si el auto se corre un poco, el recuadro va con él; si se va, se olvida", () => {
    const m = memoriaDeChapas();
    m.pendientes([AUTO], 0); m.anotar(AUTO, { texto: "", confianza: 0, caja: CHAPA });
    const corrido = [0.22, 0.3, 0.52, 0.7];
    m.pendientes([corrido], 500);
    assert.deepEqual(m.de(corrido)!.caja.map((v) => +v.toFixed(3)), [0.34, 0.6, 0.4, 0.63]);
    assert.equal(m.de([0.7, 0.1, 0.9, 0.4]), null, "otro vehículo en otro lugar no hereda nada");
    m.pendientes([], 30_000);
    assert.equal(m.de(AUTO), null);
});

test("no se insiste: pocos recortes por vuelta, los más grandes primero, y un tope de intentos por vehículo", () => {
    const m = memoriaDeChapas();
    const cinco = [0, 1, 2, 3, 4].map((k) => [k * 0.2, 0.1, k * 0.2 + 0.15, 0.2 + k * 0.1]), chico = [0.9, 0.9, 0.95, 0.93];
    const p = m.pendientes([...cinco, chico], 0);
    assert.equal(p.length, POR_VUELTA);
    assert.deepEqual(p[0], cinco[4], "el más alto primero");
    assert.ok(!p.includes(chico as never));
    for (let k = 0; k < INTENTOS_MAX; k++) { m.pendientes([AUTO], 1000 + k); m.anotar(AUTO, null); }
    assert.deepEqual(m.pendientes([AUTO], 5000), [], "sin chapa a la vista después de varios intentos: se lo deja en paz");
    assert.equal(m.de(AUTO), null, "y no se afirma nada: que no se encontró no es que no tenga");
});

test("la estadía de otro auto no se le cuelga al que está ahora: lo que se ve la contradice", () => {
    // La captura del 16/11: el recuadro viejo quedó sobre la puerta; la chapa de ESTE auto está abajo, atrás.
    const vieja = { plate: "SCW7383", caja: [0.62, 0.55, 0.66, 0.59] }, real = [0.74, 0.64, 0.775, 0.685];
    assert.equal(contradiceALaEstadia(vieja, { plate: "", caja: real }), true, "se encontró la chapa en otro lugar: alcanza, aunque no se la haya leído");
    assert.equal(contradiceALaEstadia(vieja, { plate: "SBL6779", caja: real }), true);
    assert.equal(contradiceALaEstadia(vieja, null), false, "sin lectura en vivo no hay con qué contradecirla");
    // El mismo auto: el recuadro en el mismo lugar (corrido un poco), o la misma chapa con una letra mal leída.
    assert.equal(contradiceALaEstadia(vieja, { plate: "", caja: [0.615, 0.555, 0.655, 0.595] }), false);
    assert.equal(contradiceALaEstadia(vieja, { plate: "SCW7388", caja: [0.62, 0.55, 0.66, 0.59] }), false);
    assert.equal(contradiceALaEstadia(vieja, { plate: "SCW7383", caja: real }), false, "misma matrícula leída con certeza: es él, aunque el recuadro viejo esté corrido");
    assert.equal(contradiceALaEstadia(vieja, { plate: "SBL6779", caja: [0.62, 0.55, 0.66, 0.59] }), true, "otra matrícula leída con certeza en ese mismo lugar: es otro");
});
