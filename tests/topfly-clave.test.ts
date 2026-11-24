/**
 * La clave de un TopFly leída de su respuesta a MYSELF# (24/11): cuándo se sabe con certeza cuál es,
 * y que en el log nunca quede. El formato exacto de esa respuesta no está publicado: por eso se
 * prueban varias formas y la regla es tapar todo lo que no sea el IMEI o una palabra conocida.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { claveDeRespuesta, respuestaSinClave } from "@/lib/topfly-clave";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tf = require("../lib-topfly.js");

const IMEI = "867284000000001";

test("MYSELF# entra en la lista cerrada; con algo más, no", () => {
    assert.equal(tf.aceptaComando("MYSELF#"), true);
    assert.equal(tf.aceptaComando("MYSELF,0000#"), false);
    assert.equal(tf.aceptaComando("PASSWORD,0000,1234#"), false, "cambiar la clave sigue afuera");
});

test("la clave se lee cuando la respuesta la nombra o cuando hay un solo dato que puede serlo", () => {
    assert.equal(claveDeRespuesta(`IMEI:${IMEI},SET MYSELF OK:PIN:a1b2#`), "a1b2");
    assert.equal(claveDeRespuesta(`${IMEI},PASSWORD=987654`), "987654");
    assert.equal(claveDeRespuesta(`IMEI:${IMEI},4321#`), "4321");
});

test("si hay dos datos que pueden ser la clave, no se adivina", () => {
    assert.equal(claveDeRespuesta(`IMEI:${IMEI},SET MYSELF OK:12345,6789#`), null);
    assert.equal(claveDeRespuesta(`IMEI:${IMEI},SET HBT ERROR:[-102]#`), null);
});

test("en el log la clave queda tapada; lo demás se lee", () => {
    assert.equal(respuestaSinClave(`IMEI:${IMEI},SET MYSELF OK:PIN:a1b2#`), `IMEI:${IMEI},SET MYSELF OK:PIN:····#`);
    assert.equal(respuestaSinClave(`IMEI:${IMEI},SET HBT ERROR:[-102]#`), `IMEI:${IMEI},SET HBT ERROR:[-102]#`, "una respuesta sin clave no se toca");
    // La que no dice que es una clave se tapa igual si es la respuesta a un MYSELF# recién mandado.
    assert.equal(respuestaSinClave(`IMEI:${IMEI},4321#`, true), `IMEI:${IMEI},····#`);
    assert.equal(respuestaSinClave(`IMEI:${IMEI},4321#`), `IMEI:${IMEI},4321#`);
});
