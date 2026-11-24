/** Desde qué cuenta se le escribe a un lote (lib/correo-administracion, 25/11). Cuentas inventadas. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { remitenteDeLotes, lotesDeInvitacion } from "@/lib/correo-administracion";
import { limpiarClaveDeAplicacion } from "@/lib/correo";

const admins = new Map([
    ["a7", { id: "a7", nombre: "7ª Etapa", correoCuenta: "etapa7@gmail.com", correoClave: "abcdabcdabcdabcd", correoNombre: null }],
    ["a6", { id: "a6", nombre: "6ª Etapa", correoCuenta: "etapa6@gmail.com", correoClave: null, correoNombre: null }],
]);
const lotes = new Map<string, string | null>([["u1", "a7"], ["u2", "a6"], ["u3", null]]);

test("un lote de una administración con cuenta sale desde esa cuenta, con el nombre de la administración", () => {
    const r = remitenteDeLotes(["u1"], lotes, admins);
    assert.equal(r.tipo, "administracion");
    assert.equal(r.tipo === "administracion" && r.cuenta.cuenta, "etapa7@gmail.com");
    assert.equal(r.tipo === "administracion" && r.cuenta.nombre, "7ª Etapa");
});

test("sin clave cargada, la administración no tiene desde dónde mandar: espera, no sale por otra casilla", () => {
    assert.deepEqual(remitenteDeLotes(["u2"], lotes, admins), { tipo: "sin-cuenta", administracionId: "a6", nombre: "6ª Etapa" });
});

test("un lote sin administración usa el servidor general; con lotes en dos, manda la del primero", () => {
    assert.deepEqual(remitenteDeLotes(["u3"], lotes, admins), { tipo: "general" });
    assert.equal(remitenteDeLotes(["u3", "u2", "u1"], lotes, admins).tipo, "sin-cuenta");
    assert.equal(remitenteDeLotes(["u1", "u2"], lotes, admins).tipo, "administracion");
});

test("los lotes de una invitación y la clave de aplicación sin espacios", () => {
    assert.deepEqual(lotesDeInvitacion([{ unitId: "u1", nombre: "A 2 (4-5)" }, { nombre: "sin id" }]), ["u1"]);
    assert.equal(limpiarClaveDeAplicacion("abcd efgh ijkl mnop"), "abcdefghijklmnop");
});
