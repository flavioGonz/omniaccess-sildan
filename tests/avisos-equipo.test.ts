/** Avisos por equipo (lib/avisos-equipo): lo que no se tocó vale prendido, y cada tipo tiene los suyos. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AVISOS, avisosDe, claveDeAlerta, leerAjuste, prendido } from "@/lib/avisos-equipo";
import { alertasDeFila } from "@/components/devices/AlertasFila";

test("avisos: sin ajuste, todo prendido (un equipo que nadie tocó avisa como siempre)", () => {
    const aj = leerAjuste(null);
    for (const a of AVISOS) assert.equal(prendido(aj, a.clave), true);
    assert.equal(prendido(aj, "telegram"), true);
});

test("avisos: el ajuste guardado descarta lo que no es un aviso o no es booleano", () => {
    const aj = leerAjuste({ movida: false, telegram: false, cualquiera: false, tapada: "no" });
    assert.deepEqual(aj, { movida: false, telegram: false });
    assert.equal(prendido(aj, "movida"), false);
    assert.equal(prendido(aj, "tapada"), true);
});

test("avisos: cada tipo de equipo tiene los suyos", () => {
    const nvr = avisosDe("NVR").map((a) => a.clave);
    assert.ok(nvr.includes("disk") && !nvr.includes("movida"));
    const cam = avisosDe("CAMERA").map((a) => a.clave);
    assert.ok(cam.includes("movida") && cam.includes("tapada") && !cam.includes("disk"));
    assert.equal(avisosDe("ALARM_HUB").length, 0);
});

test("avisos: la alerta «imagen» no tiene una clave sola (la decide el problema)", () => {
    assert.equal(claveDeAlerta("imagen"), null);
    assert.equal(claveDeAlerta("offline"), "offline");
    assert.equal(claveDeAlerta("algo-de-una-central"), null);
});

test("fila: las alertas de cuentas locales no van en la fila del equipo", () => {
    const a = (type: string) => ({ id: type, deviceId: "x", type, severity: "warning", message: "" });
    const fila = alertasDeFila([a("drift"), a("cuenta-no-gestionada:op"), a("sesion-desconocida:admin@1.2.3.4"), a("imagen")]);
    assert.deepEqual(fila.map((x) => x.type), ["drift", "imagen"]);
});
