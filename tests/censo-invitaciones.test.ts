/** El censo con clave por lote (lib/censo-invitaciones). */
import test from "node:test";
import assert from "node:assert/strict";
import { CID_LOGO, seConfunden, correoDeInvitacion, correoSirve, leerPlanilla, normalizarClave, normalizarLoteInv, nuevaClave } from "@/lib/censo-invitaciones";

test("la clave no usa caracteres que se confunden", () => {
    for (let i = 0; i < 200; i++) {
        const c = nuevaClave();
        assert.match(c, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
        assert.equal(/[OI L S Z 0 1 2 5]/.test(c.replace("-", "").replace(/ /g, "")), false, c);
    }
});

test("la clave se acepta como la copia la gente", () => {
    const c = nuevaClave();
    const plano = c.replace("-", "");
    assert.equal(normalizarClave(plano.toLowerCase()), c);
    assert.equal(normalizarClave(` ${plano.slice(0, 4)} ${plano.slice(4)} `), c);
    assert.equal(normalizarClave(c), c);
});

test("lo que no es una clave se dice que no lo es", () => {
    assert.equal(normalizarClave("ABC-12"), null);        // corta
    assert.equal(normalizarClave("ABCDEFGHJKMNP"), null); // larga
    assert.equal(normalizarClave(""), null);
    assert.equal(normalizarClave(null), null);
});

test("el lote se guarda igual lo escriba como lo escriba", () => {
    for (const x of ["b 4", "B4", "Lote B4", " lote  b4 "]) assert.equal(normalizarLoteInv(x), "B4", x);
});

test("la planilla con cabecera", () => {
    const r = leerPlanilla([
        ["Lote", "Correo", "Nombre"],
        ["B4", "ana@correo.com", "Ana Pérez"],
        ["lote C7", " LUIS@CORREO.COM ", "Luis"],
    ]);
    assert.deepEqual(r.filas, [
        { lote: "B4", email: "ana@correo.com", nombre: "Ana Pérez" },
        { lote: "C7", email: "luis@correo.com", nombre: "Luis" },
    ]);
    assert.deepEqual(r.errores, []);
});

test("la planilla sin cabecera: la columna del correo es la que tiene arrobas", () => {
    const r = leerPlanilla([["B4", "ana@correo.com"], ["C7", "luis@correo.com"]]);
    assert.equal(r.filas.length, 2);
    assert.equal(r.filas[0].lote, "B4");
});

test("un lote sin correo no frena a los demás, y se avisa", () => {
    const r = leerPlanilla([["Lote", "Correo"], ["B4", "ana@correo.com"], ["C7", ""], ["D1", "no-es-correo"]]);
    assert.deepEqual(r.filas.map((f) => f.lote), ["B4"]);
    assert.equal(r.errores.length, 2);
    assert.match(r.errores.join(" "), /C7/);
    assert.match(r.errores.join(" "), /D1/);
});

test("el mismo lote dos veces se queda con el último", () => {
    const r = leerPlanilla([["Lote", "Correo"], ["B4", "vieja@correo.com"], ["B4", "nueva@correo.com"]]);
    assert.equal(r.filas.length, 1);
    assert.equal(r.filas[0].email, "nueva@correo.com");
    assert.equal(r.repetidos, 1);
});

test("una planilla vacía lo dice", () => {
    assert.match(leerPlanilla([]).errores[0], /vacía/);
    assert.match(leerPlanilla([["hola", "qué tal"]]).errores[0], /correos/);
});

test("el correo lleva el enlace, la clave y el lote", () => {
    const c = correoDeInvitacion({ barrio: "San Nicolás", lote: "B4", url: "https://x/registro/ABCD-3456", clave: "ABCD-3456" });
    assert.match(c.asunto, /lote B4/);
    assert.ok(c.texto.includes("https://x/registro/ABCD-3456"));
    assert.ok(c.texto.includes("ABCD-3456"));
    assert.ok(c.html.includes("https://x/registro/ABCD-3456"));
    // Lo que entra del afuera va escapado: un apellido con < no puede romper el correo.
    const malo = correoDeInvitacion({ barrio: "<b>x", lote: "B4", url: "https://x", clave: "A", nombre: "<script>" });
    assert.equal(malo.html.includes("<script>"), false);
});

test("el logo va citado sólo cuando viaja adjunto", () => {
    const base = { barrio: "San Nicolás", lote: "B4", url: "https://x/registro/ABCD-3456", clave: "ABCD-3456" };
    const con = correoDeInvitacion({ ...base, conLogo: true });
    assert.ok(con.html.includes(`src="cid:${CID_LOGO}"`));
    // Sin el adjunto, una <img> sería un recuadro roto: la marca va escrita.
    const sin = correoDeInvitacion(base);
    assert.equal(sin.html.includes("<img"), false);
    assert.match(sin.html, />OmniAccess<\/span>/);
    // Sin nombre, la frase empieza con mayúscula.
    assert.match(sin.html, /\n\s+Cargá las matrículas/);
    assert.match(sin.texto, /^Este es el registro/);
});

test("qué es un correo y qué no", () => {
    assert.ok(correoSirve("ana@correo.com"));
    assert.equal(correoSirve("ana@correo"), false);
    assert.equal(correoSirve("ana correo.com"), false);
    assert.equal(correoSirve(""), false);
});

test("un código puesto a mano puede tener cualquier letra o número, de 6 a 12", () => {
    // Las de ocho siguen en dos grupos de cuatro, vengan de donde vengan.
    assert.equal(normalizarClave("lote 0215"), "LOTE-0215");
    assert.equal(normalizarClave("SN-A2-2026"), "SNA2-2026");
    // Las de otro largo se guardan seguidas.
    assert.equal(normalizarClave("casa 15"), "CASA15");
    assert.equal(normalizarClave("ñandú-123456"), "AND123456");
    // Se avisa qué caracteres se prestan a confusión; no se prohíben.
    assert.deepEqual(seConfunden("LOTE-0215").sort(), ["0", "1", "2", "5", "L", "O"]);
    assert.deepEqual(seConfunden(nuevaClave()), []);
});

test("el recordatorio lo dice en el asunto y arriba del correo; la invitación no (27/11)", () => {
    const base = { barrio: "Barrio", lote: "B4", url: "https://x.uy/registro/AB", clave: "AB" };
    const r = correoDeInvitacion({ ...base, recordatorio: true });
    assert.match(r.asunto, /^Recordatorio · Censo de vehículos · lote B4$/);
    assert.match(r.texto, /^Te escribimos de nuevo porque tu lote todavía no tiene el censo completo\./);
    assert.match(r.html, /Te escribimos de nuevo/);
    const i = correoDeInvitacion(base);
    assert.doesNotMatch(i.asunto, /Recordatorio/);
    assert.doesNotMatch(i.html, /Te escribimos de nuevo/);
});

test("el correo dice que lo cargado se puede ver y corregir, y que va el manual adjunto (27/11)", () => {
    const base = { barrio: "Barrio", lote: "B4", url: "https://x.uy/registro/AB", clave: "AB" };
    const c = correoDeInvitacion({ ...base, altaDirecta: true, conManual: true });
    assert.match(c.texto, /se puede ver y corregir/);
    assert.match(c.texto, /Manual del residente/);
    assert.match(c.html, /lo que cargaste se puede corregir/);
    assert.match(c.texto, /queda en el padrón al guardarlo/);
    assert.doesNotMatch(c.texto, /revisa lo que cargues/);
    const cerrado = correoDeInvitacion(base);
    assert.match(cerrado.texto, /revisa lo que cargues/);
    assert.doesNotMatch(cerrado.texto, /Manual del residente/);
});

test("al lote que ya cargó le llega la novedad, no el recordatorio (27/11)", () => {
    const c = correoDeInvitacion({ barrio: "B", lote: "B4", url: "https://x.uy/r/AB", clave: "AB", novedad: true });
    assert.match(c.asunto, /^Novedad · Censo de vehículos · lote B4$/);
    assert.match(c.texto, /ya tiene el censo cargado/);
    assert.doesNotMatch(c.texto, /todavía no tiene/);
});
