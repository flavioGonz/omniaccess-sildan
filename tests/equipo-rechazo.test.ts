import test from "node:test";
import assert from "node:assert/strict";
import { anotarRechazo, comoSeCuenta, frenado, leerUserCheck, limpiarRechazo, olvidarTodo } from "@/lib/equipo-rechazo";

const BLOQUEADO = `<?xml version="1.0" encoding="UTF-8"?>
<userCheck version="2.0"><statusValue>401</statusValue><statusString>Unauthorized</statusString>
<isActivated>true</isActivated><lockStatus>lock</lockStatus><unlockTime>1580</unlockTime><retryLoginTime>0</retryLoginTime></userCheck>`;
const RECHAZANDO = `<userCheck><statusValue>401</statusValue><lockStatus>unlock</lockStatus><unlockTime>0</unlockTime><retryLoginTime>2</retryLoginTime></userCheck>`;

test("lee el aviso de un equipo bloqueado", () => {
    const r = leerUserCheck(BLOQUEADO)!;
    assert.equal(r.bloqueado, true);
    assert.equal(r.faltan, 1580);
    assert.equal(r.quedan, 0);
});

test("lee el aviso de un equipo que rechaza y cuenta los intentos", () => {
    const r = leerUserCheck(RECHAZANDO)!;
    assert.equal(r.bloqueado, false);
    assert.equal(r.quedan, 2);
});

test("un cuerpo que no es userCheck no dice nada", () => {
    assert.equal(leerUserCheck('{"statusCode":1}'), null);
    assert.equal(leerUserCheck(""), null);
});

test("el freno de un bloqueo dura al menos lo que el equipo pidió", () => {
    olvidarTodo();
    const t = 1_000_000;
    anotarRechazo("x", leerUserCheck(BLOQUEADO)!, "El terminal", t);
    assert.ok(frenado("x", t + 1_000_000));          // 1000 s después: sigue frenado (pidió 1580)
    assert.equal(frenado("x", t + 1_581_000), null); // pasado el tiempo que pidió: se le habla
});

test("el rechazo de clave frena largo: no hay nada que esperar que lo arregle", () => {
    olvidarTodo();
    const t = 2_000_000;
    anotarRechazo("y", leerUserCheck(RECHAZANDO)!, "El terminal", t);
    const m = frenado("y", t + 60_000);
    assert.ok(m && m.includes("2 intentos"), m || "sin motivo");
    assert.equal(frenado("y", t + 16 * 60_000), null);
});

test("una respuesta buena borra el freno", () => {
    olvidarTodo();
    anotarRechazo("z", leerUserCheck(RECHAZANDO)!, "El terminal");
    limpiarRechazo("z");
    assert.equal(frenado("z"), null);
});

test("lo que se le cuenta a la persona dice qué hacer", () => {
    assert.match(comoSeCuenta(leerUserCheck(BLOQUEADO)!, "El terminal"), /bloqueó al usuario por 27 minutos/);
    assert.match(comoSeCuenta(leerUserCheck(RECHAZANDO)!, "El terminal"), /revisar la clave/);
});
