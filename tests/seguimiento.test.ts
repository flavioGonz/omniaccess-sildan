/** El resumen de seguimiento de una ficha amarilla (lib/seguimiento › combinarSeguimiento). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { combinarSeguimiento, franjaDe, type ActividadMatricula } from "@/lib/seguimiento";

const ahora = new Date("2026-11-12T15:00:00Z");
const horas = (pares: [number, number][]) => { const h = Array<number>(24).fill(0); for (const [i, n] of pares) h[i] = n; return h; };

const A: ActividadMatricula = {
    plate: "SBX1234", ultima: "2026-11-12T10:14:00.000Z",
    porDia: [{ dia: "2026-09-01", n: 2 }, { dia: "2026-10-20", n: 1 }, { dia: "2026-11-07", n: 3 }, { dia: "2026-11-12", n: 2 }],
    porHora: horas([[22, 6], [8, 2]]),
    pasadas: [{ deviceName: "Portón Sur" }, { deviceName: "Portón Sur" }, { deviceName: "Portón Norte" }],
};
const B: ActividadMatricula = {
    plate: "AAU9032", ultima: "2026-11-07T23:01:00.000Z",
    porDia: [{ dia: "2026-11-07", n: 1 }, { dia: "2026-11-05", n: 4 }],
    porHora: horas([[22, 3], [23, 2]]),
    pasadas: [{ deviceName: "Portón Norte" }, { deviceName: null }],
};

test("una matrícula: 7 y 30 días, días activos, primera y última", () => {
    const r = combinarSeguimiento([A], ahora);
    assert.equal(r.lecturas7, 5);       // 7/11 y 12/11
    assert.equal(r.lecturas30, 6);      // + 20/10
    assert.equal(r.diasActivos30, 3);
    assert.equal(r.primera, "2026-09-01");
    assert.equal(r.ultima, "2026-11-12T10:14:00.000Z");
    assert.equal(r.sinLecturas, false);
});

test("dos matrículas: suma, y un día compartido cuenta una sola vez", () => {
    const r = combinarSeguimiento([A, B], ahora);
    assert.equal(r.lecturas7, 6);       // A: 3+2 · B: el 7/11 (el 5/11 queda fuera de los 7 días)
    assert.equal(r.lecturas30, 11);
    assert.equal(r.diasActivos30, 4);   // 20/10, 5/11, 7/11 (compartido), 12/11
    assert.equal(r.ultima, "2026-11-12T10:14:00.000Z");
    assert.deepEqual(r.porMatricula, [{ plate: "SBX1234", lecturas30: 6, ultima: A.ultima }, { plate: "AAU9032", lecturas30: 5, ultima: B.ultima }]);
});

test("franja y cámaras, de más a menos", () => {
    const r = combinarSeguimiento([A, B], ahora);
    assert.equal(r.horaPico, 22);
    assert.equal(r.franja, "noche");
    assert.deepEqual(r.camaras, [{ nombre: "Portón Norte", n: 2 }, { nombre: "Portón Sur", n: 2 }, { nombre: "Cámara sin nombre", n: 1 }]);
    assert.equal(franjaDe(3), "madrugada");
    assert.equal(franjaDe(8), "mañana");
    assert.equal(franjaDe(15), "tarde");
});

test("nunca se la vio: lo dice, sin inventar hora pico", () => {
    const r = combinarSeguimiento([{ plate: "XYZ0001", ultima: null, porDia: [], porHora: horas([]), pasadas: [] }], ahora);
    assert.equal(r.sinLecturas, true);
    assert.equal(r.lecturas30, 0);
    assert.equal(r.horaPico, null);
    assert.equal(r.franja, null);
    assert.deepEqual(r.camaras, []);
});

test("sin matrículas no rompe", () => {
    assert.equal(combinarSeguimiento([], ahora).sinLecturas, true);
});
