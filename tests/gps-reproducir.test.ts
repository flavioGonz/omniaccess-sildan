import test from "node:test";
import assert from "node:assert/strict";
import { posicionEn, RETRASO_MS, type Punto } from "@/lib/gps-reproducir";
import { metrosEntre } from "@/lib/gps-recorrido";

test("entre dos posiciones interpola por la hora, no por partes iguales", () => {
    const cola: Punto[] = [{ t: 0, lat: 0, lon: 0 }, { t: 4000, lat: 0.004, lon: 0 }, { t: 14000, lat: 0.014, lon: 0 }];
    assert.equal(posicionEn(cola, 2000)!.lat, 0.002);
    assert.ok(Math.abs(posicionEn(cola, 9000)!.lat - 0.009) < 1e-9);
    assert.equal(posicionEn(cola, 99999)!.llego, true);
    assert.equal(posicionEn(cola, -5)!.lat, 0);
    assert.equal(posicionEn([], 0), null);
});

test("con los intervalos REALES del equipo el dibujo va a velocidad pareja y no se frena", () => {
    /* Un auto a 50 km/h constantes, reportando como reportó el equipo de Nico el 21/11: casi
       siempre a los 10 s, a veces a los 4–5 (cuando dobla), alguna vez a los 12. Cada posición
       llega al navegador 2 s después de tomada. Se mira el dibujo cada 100 ms. */
    const intervalos = [10, 10, 4, 10, 5, 10, 10, 12, 10, 4, 10, 10, 10, 5, 10, 11, 10];
    const mps = 50 / 3.6, gradoPorMetro = 1 / 111_195;
    const reales: Punto[] = [{ t: 0, lat: 0, lon: 0 }];
    for (const s of intervalos) { const u = reales[reales.length - 1]; reales.push({ t: u.t + s * 1000, lat: u.lat + mps * s * gradoPorMetro, lon: 0 }); }
    const LLEGA_MS = 2000;

    let anterior: { lat: number; lon: number } | null = null;
    let quieto = 0, pasos = 0, vMin = Infinity, vMax = 0;
    const desde = reales[2].t + RETRASO_MS, hasta = reales[reales.length - 1].t + LLEGA_MS;   // con el camino ya en marcha
    for (let ahora = desde; ahora <= hasta; ahora += 100) {
        const conocidas = reales.filter((p) => p.t + LLEGA_MS <= ahora);
        const p = posicionEn(conocidas, ahora - LLEGA_MS - RETRASO_MS)!;
        if (anterior) {
            const v = metrosEntre(anterior, p) / 0.1;      // m/s del DIBUJO
            pasos++;
            if (v < 0.5) quieto++;
            vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
        }
        anterior = p;
    }
    assert.equal(quieto, 0, `se frenó ${quieto} veces en ${pasos} cuadros`);
    /* La velocidad del dibujo es la del auto, todo el tiempo: ni tirones ni carreras. */
    assert.ok(vMin > mps * 0.98 && vMax < mps * 1.02, `dibujo entre ${vMin.toFixed(2)} y ${vMax.toFixed(2)} m/s (real ${mps.toFixed(2)})`);
});

test("el deslizamiento de antes, con esos mismos intervalos, sí se frenaba (por qué se cambió)", () => {
    /* La versión anterior: ante cada posición nueva, ir desde donde está dibujado hasta ella en
       diez segundos fijos. Con un intervalo de 12 s llega a los 10 y espera 2 quieto. */
    const intervalos = [10, 12, 10, 15];
    let dibujado = 0, objetivo = 0, t0 = 0, desdeDonde = 0, quieto = 0, real = 0;
    const llegadas: number[] = []; let acc = 0; for (const s of intervalos) { acc += s * 1000; llegadas.push(acc); }
    for (let ahora = 0; ahora <= acc; ahora += 100) {
        if (llegadas.includes(ahora)) { real += 1; desdeDonde = dibujado; objetivo = real; t0 = ahora; }
        const antes = dibujado;
        dibujado = desdeDonde + (objetivo - desdeDonde) * Math.min(1, (ahora - t0) / 10_000);
        if (ahora > llegadas[0] && dibujado === antes) quieto++;
    }
    assert.ok(quieto > 30, `quieto ${quieto} cuadros`);      // más de 3 segundos parado en 37 de recorrido
});
