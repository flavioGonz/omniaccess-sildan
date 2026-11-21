/** En qué está la invitación al censo de cada persona del padrón (lib/censo-estado). Datos inventados. */
import test from "node:test";
import assert from "node:assert/strict";
import { buscadorDeCenso, conInvitacion, type InvitacionResumen } from "@/lib/censo-estado";

const inv = (d: Partial<InvitacionResumen>): InvitacionResumen => ({ userId: null, email: "ana@ejemplo.com", enviadoAt: null, usadoAt: null, error: null, ...d });

test("sin correo no hay a dónde mandar, aunque tenga una invitación vieja", () => {
    const de = buscadorDeCenso([inv({ userId: "u1", enviadoAt: "2026-11-21T12:00:00Z" })]);
    assert.equal(de({ id: "u1", email: null }).que, "sin-correo");
    assert.equal(de({ id: "u1", email: "no es un correo" }).que, "sin-correo");
});

test("se la encuentra por la persona y, si no, por el correo", () => {
    const de = buscadorDeCenso([
        inv({ userId: "u1", email: "viejo@ejemplo.com", enviadoAt: "2026-11-21T12:00:00Z" }),
        inv({ email: "Beto@Ejemplo.com", enviadoAt: "2026-11-21T13:00:00Z" }),
    ]);
    // Cambió de correo después de la invitación: sigue siendo la suya.
    assert.equal(de({ id: "u1", email: "nuevo@ejemplo.com" }).que, "enviada");
    // La de la planilla simple no sabe de quién es: se reconoce por el correo, sin importar mayúsculas.
    assert.equal(de({ id: "u2", email: " beto@ejemplo.com " }).que, "enviada");
    assert.equal(de({ id: "u3", email: "nadie@ejemplo.com" }).que, "sin-enviar");
});

test("el orden: cargó gana a todo, después el error, después enviada", () => {
    const de = (d: Partial<InvitacionResumen>) => buscadorDeCenso([inv({ userId: "u1", ...d })])({ id: "u1", email: "ana@ejemplo.com" });
    assert.equal(de({}).que, "sin-enviar");
    assert.equal(de({ enviadoAt: "2026-11-21T12:00:00Z" }).que, "enviada");
    // Salió una vez y el reenvío falló: lo que hay que ver es el error.
    const e = de({ enviadoAt: "2026-11-21T12:00:00Z", error: "550 no existe" });
    assert.equal(e.que, "error"); assert.equal(e.error, "550 no existe");
    assert.equal(de({ enviadoAt: "2026-11-21T12:00:00Z", error: "550", usadoAt: "2026-11-22T09:00:00Z" }).que, "cargo");
});

test("la que acaba de salir reemplaza a la que había, o se suma", () => {
    const a = inv({ userId: "u1" }), b = inv({ userId: "u2", email: "beto@ejemplo.com" });
    const salio = inv({ userId: "u1", enviadoAt: "2026-11-23T10:00:00Z" });
    assert.deepEqual(conInvitacion([a, b], salio), [salio, b]);
    const nueva = inv({ userId: "u9", email: "caro@ejemplo.com", enviadoAt: "2026-11-23T10:00:00Z" });
    assert.equal(conInvitacion([a, b], nueva).length, 3);
});
