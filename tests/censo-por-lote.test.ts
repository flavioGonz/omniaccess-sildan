import test from "node:test";
import assert from "node:assert/strict";
import { planDeInvitaciones, principalDeLote, type InvitacionExistente, type Miembro } from "@/lib/censo-por-lote";

const m = (userId: string, vinculo: string, desde: number, email: string | null = `${userId}@ejemplo.uy`): Miembro => ({ userId, nombre: userId.toUpperCase(), email, vinculo, desde });
const inv = (id: string, x: Partial<InvitacionExistente>): InvitacionExistente => ({ id, unitId: null, userId: null, email: "", nombre: "", lote: "", lotes: [], enviadoAt: null, usadoAt: null, aMano: false, ...x });

test("censo por lote: la principal es el primer propietario con correo; si no hay, el primer inquilino", () => {
    assert.equal(principalDeLote([m("inq", "INQUILINO", 1), m("pro2", "PROPIETARIO", 3), m("pro1", "PROPIETARIO", 2)])?.userId, "pro1");
    assert.equal(principalDeLote([m("fam", "FAMILIA", 1), m("inq", "INQUILINO", 2), m("pro", "PROPIETARIO", 0, null)])?.userId, "inq", "un propietario sin correo no cuenta");
    assert.equal(principalDeLote([m("a", "PROPIETARIO", 1, "malo")]), null);
});
test("censo por lote: manda la planilla, y por encima lo elegido a mano", () => {
    const gente = [m("a", "PROPIETARIO", 1), m("b", "PROPIETARIO", 2), m("c", "INQUILINO", 3)];
    assert.equal(principalDeLote(gente, { preferido: "B@ejemplo.uy" })?.userId, "b");
    assert.equal(principalDeLote(gente, { preferido: "b@ejemplo.uy", aMano: "c" })?.userId, "c");
    assert.equal(principalDeLote(gente, { aMano: "se-fue" })?.userId, "a", "si la elegida a mano ya no está, vuelve la regla");
});
test("censo por lote: la invitación vieja por persona pasa a su primer lote con su clave; la del segundo es nueva", () => {
    const lotes = [
        { unitId: "L1", nombre: "A 1 (4-5)", miembros: [m("ana", "PROPIETARIO", 1), m("beto", "PROPIETARIO", 2)] },
        { unitId: "L2", nombre: "A 2 (4-5)", miembros: [m("ana", "PROPIETARIO", 1)] },
        { unitId: "L3", nombre: "A 3 (4-5)", miembros: [m("caro", "INQUILINO", 1)] },
        { unitId: "L4", nombre: "A 4 (4-5)", miembros: [] },
    ];
    const viejas = [
        inv("vAna", { userId: "ana", email: "ana@ejemplo.uy", lotes: [{ unitId: "L1" }, { unitId: "L2" }], enviadoAt: "2026-11-25T20:58:00Z" }),
        inv("vBeto", { userId: "beto", email: "beto@ejemplo.uy", lotes: [{ unitId: "L1" }] }),
        inv("vCaro", { userId: "caro", email: "caro@ejemplo.uy", lotes: [{ unitId: "L3" }] }),
        inv("vUsada", { userId: "dani", email: "dani@ejemplo.uy", lotes: [{ unitId: "L9" }], usadoAt: "2026-11-25T21:00:00Z" }),
    ];
    const p = planDeInvitaciones(lotes, viejas);
    assert.deepEqual(p.actualizar.map((a) => [a.id, a.unitId, a.convertida]), [["vAna", "L1", true], ["vCaro", "L3", true]]);
    assert.deepEqual(p.crear.map((c) => [c.unitId, c.email]), [["L2", "ana@ejemplo.uy"]], "un correo por lote: Ana recibe dos");
    assert.deepEqual(p.borrar, [{ id: "vBeto", motivo: "no-es-principal" }], "Beto no es principal: su código se quita");
    assert.equal(p.usadasQueQuedan, 1, "una ya usada para cargar no se borra");
    assert.deepEqual(p.lotesSinPrincipal, ["A 4 (4-5)"]);
});
test("censo por lote: correr dos veces no cambia nada; cambiar la principal la marca para reenviar", () => {
    const lotes = [{ unitId: "L1", nombre: "A 1 (4-5)", miembros: [m("ana", "PROPIETARIO", 1), m("beto", "PROPIETARIO", 2)] }];
    const ya = [inv("i1", { unitId: "L1", userId: "ana", email: "ana@ejemplo.uy", nombre: "ANA", lote: "A 1 (4-5)", lotes: [{ unitId: "L1" }] })];
    const p = planDeInvitaciones(lotes, ya);
    assert.equal(p.iguales, 1); assert.equal(p.actualizar.length + p.crear.length + p.borrar.length, 0);
    const q = planDeInvitaciones([{ ...lotes[0], preferido: "beto@ejemplo.uy" }], ya);
    assert.equal(q.actualizar[0].userId, "beto"); assert.equal(q.actualizar[0].otraPersona, true);
});
test("censo por lote: un correo puesto a mano sin persona del padrón se respeta, aunque el lote no tenga gente", () => {
    const p = planDeInvitaciones([{ unitId: "L1", nombre: "Casa 1", miembros: [] }], [inv("i1", { unitId: "L1", email: "x@ejemplo.uy", aMano: true })]);
    assert.equal(p.borrar.length, 0); assert.equal(p.iguales, 1);
});
