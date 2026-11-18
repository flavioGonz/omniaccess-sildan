/** La bitácora de un control de acceso Hikvision, traducida (lib/acs-evento). */
import test from "node:test";
import assert from "node:assert/strict";
import { cuandoFue, desfasajeDeEquipo, diceDesfasaje, isoConOffset, NO_ES_ACCESO, offsetDeEquipo, traducirAcs } from "@/lib/acs-evento";

/* Los tres son eventos REALES del DS-K1T343MFWX de la instalación, copiados tal cual. */
const TARJETA = { major: 5, minor: 1, time: "2026-10-31T14:05:06-03:00", cardNo: "2244111551", cardType: 1, name: "304", cardReaderNo: 1, doorNo: 1, employeeNoString: "304", serialNo: 15409, userType: "normal", currentVerifyMode: "faceOrFpOrCardOrPw" };
const ROSTRO = { major: 5, minor: 75, time: "2026-11-01T20:35:11-03:00", cardNo: "1673902271", name: "612", cardReaderNo: 1, doorNo: 1, employeeNoString: "1109", serialNo: 15446 };
const ROSTRO_NO = { major: 5, minor: 76, time: "2026-11-02T11:26:03-03:00", cardReaderNo: 1, doorNo: 1, serialNo: 15458 };

test("una tarjeta válida es un acceso con su persona", () => {
    const t = traducirAcs(TARJETA)!;
    assert.equal(t.decision, "GRANT");
    assert.equal(t.tipo, "TAG");
    assert.equal(t.credencial, "2244111551");
    assert.equal(t.legajo, "304");
    assert.equal(t.puerta, 1);
    assert.equal(t.serie, 15409);
});

test("el rostro, reconocido y no reconocido", () => {
    assert.equal(traducirAcs(ROSTRO)!.decision, "GRANT");
    assert.equal(traducirAcs(ROSTRO)!.legajo, "1109");
    const no = traducirAcs(ROSTRO_NO)!;
    assert.equal(no.decision, "DENY");
    assert.equal(no.tipo, "FACE");
    assert.equal(no.credencial, null);
});

test("la puerta abriéndose NO es un acceso, y se sabe por qué", () => {
    assert.equal(traducirAcs({ major: 5, minor: 21, time: "2026-10-31T14:05:06-03:00" }), null);
    assert.equal(traducirAcs({ major: 5, minor: 22 }), null);
    assert.equal(NO_ES_ACCESO["5/21"], "puerta abierta");
    assert.equal(NO_ES_ACCESO["3/122"], "se cambió la configuración del equipo");
});

test("un código que no sabemos leer no se inventa", () => {
    assert.equal(traducirAcs({ major: 5, minor: 999 }), null);
    assert.equal(traducirAcs({}), null);
});

test("el reloj del equipo se mide y se descuenta", () => {
    const ahora = Date.parse("2026-11-18T16:17:37-03:00");
    // Lo que contestó el equipo real: once horas atrasado.
    const d = desfasajeDeEquipo("2026-11-18T05:17:37-03:00", ahora)!;
    assert.equal(Math.round(d / 3_600_000), -11);
    assert.match(diceDesfasaje(d), /11 h atrasado/);
    // Un evento suyo, corregido, cae once horas más tarde de lo que el equipo dice.
    const real = cuandoFue(TARJETA, d)!;
    assert.equal(real.toISOString(), new Date(Date.parse(TARJETA.time) + 11 * 3_600_000).toISOString());
});

test("sin desfasaje medido, la hora del evento se respeta", () => {
    assert.equal(desfasajeDeEquipo(null), null);
    assert.equal(desfasajeDeEquipo("cualquier cosa"), null);
    assert.equal(cuandoFue(TARJETA, null)!.toISOString(), new Date(Date.parse(TARJETA.time)).toISOString());
    assert.equal(cuandoFue({ time: "no es hora" }, 0), null);
});

test("la fecha va con el huso del equipo, no en Z", () => {
    // El equipo contesta 400 con «...Z»: quiere el huso escrito.
    const t = Date.parse("2026-11-18T12:00:00Z");
    assert.equal(isoConOffset(t, "-03:00"), "2026-11-18T09:00:00-03:00");
    assert.equal(isoConOffset(t, "+08:00"), "2026-11-18T20:00:00+08:00");
    assert.equal(offsetDeEquipo("2026-11-18T05:46:35-03:00"), "-03:00");
    assert.equal(offsetDeEquipo("2026-11-18T11:21:26+08:00"), "+08:00");
});
