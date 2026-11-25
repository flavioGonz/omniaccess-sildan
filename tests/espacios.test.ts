import test from "node:test";
import assert from "node:assert/strict";
import { choque, diasDeSemana, inicioDeSemana, posicionEnDia, problemaDeTurno } from "@/lib/espacios";

const r = (id: string, a: string, b: string, estado = "CONFIRMADA") => ({ id, inicio: `2026-11-28T${a}:00-03:00`, fin: `2026-11-28T${b}:00-03:00`, estado });

test("espacios: un turno que se pisa con otro choca; uno que empieza cuando el otro termina, no", () => {
    const ya = [r("a", "14", "18"), r("b", "20", "23")];
    assert.equal(choque(ya, r("x", "17", "19"))?.id, "a");
    assert.equal(choque(ya, r("x", "18", "20")), null, "de 14 a 18 y de 18 a 20 es lo normal");
    assert.equal(choque(ya, r("x", "13", "23"))?.id, "a");
});
test("espacios: las canceladas no ocupan, y una reserva no choca consigo misma al editarla", () => {
    assert.equal(choque([r("a", "14", "18", "CANCELADA")], r("x", "15", "16")), null);
    assert.equal(choque([r("a", "14", "18")], { ...r("a", "15", "19"), id: "a" }), null);
});
test("espacios: lo que hace inválido un turno se dice en palabras", () => {
    const ahora = Date.parse("2026-11-25T12:00:00-03:00");
    assert.equal(problemaDeTurno(r("x", "18", "14"), ahora), "La hora de fin tiene que ser después de la de inicio.");
    assert.match(problemaDeTurno({ inicio: "2026-11-01T10:00:00-03:00", fin: "2026-11-01T12:00:00-03:00" }, ahora) || "", /ya pasó/);
    assert.equal(problemaDeTurno(r("x", "14", "18"), ahora), null);
});
test("espacios: la semana arranca el lunes y tiene siete días", () => {
    const l = inicioDeSemana(new Date(2026, 10, 27, 15));     // viernes 27/11
    assert.equal(l.getDay(), 1); assert.equal(l.getDate(), 23);
    assert.equal(inicioDeSemana(new Date(2026, 10, 29)).getDate(), 23, "el domingo es de la semana que empezó el lunes");
    assert.equal(diasDeSemana(l).length, 7);
});
test("espacios: dónde cae un turno en la franja del día, recortado", () => {
    const dia = new Date(2026, 10, 28);
    const p = posicionEnDia({ inicio: new Date(2026, 10, 28, 16), fin: new Date(2026, 10, 28, 20) }, dia, 8, 24)!;
    assert.equal(p.arriba, 0.5); assert.equal(p.alto, 0.25);
    assert.equal(posicionEnDia({ inicio: new Date(2026, 10, 29, 10), fin: new Date(2026, 10, 29, 12) }, dia, 8, 24), null);
    const tarde = posicionEnDia({ inicio: new Date(2026, 10, 28, 22), fin: new Date(2026, 10, 29, 2) }, dia, 8, 24)!;
    assert.equal(tarde.arriba + tarde.alto, 1, "lo que pasa de medianoche se recorta al día");
});
