/** Decir un punto en palabras (lib/direccion-texto), con respuestas como las de Nominatim. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { claveDeLugar, lugarConDireccion, textoDeDireccion } from "@/lib/direccion-texto";

test("una dirección de ciudad: calle y número, barrio, ciudad", () => {
    const d = textoDeDireccion({ road: "Cavour", house_number: "3230", suburb: "La Blanqueada", city: "Montevideo", state: "Montevideo", country: "Uruguay" });
    assert.deepEqual(d, { texto: "Cavour 3230, La Blanqueada, Montevideo", calle: "Cavour 3230", barrio: "La Blanqueada", ciudad: "Montevideo" });
});

test("sin número va la calle sola, y el país nunca", () => {
    assert.equal(textoDeDireccion({ road: "General Urquiza", suburb: "Larrañaga", city: "Montevideo", country: "Uruguay" })?.texto, "General Urquiza, Larrañaga, Montevideo");
});

test("en una ciudad chica el barrio y la ciudad se llaman igual: se dice una vez", () => {
    assert.equal(textoDeDireccion({ road: "18 de Julio", suburb: "Minas", town: "Minas", state: "Lavalleja" })?.texto, "18 de Julio, Minas");
    assert.equal(textoDeDireccion({ road: "Ruta 8", town: "MINAS", suburb: "Minas" })?.texto, "Ruta 8, Minas");
});

test("en el campo, sin calle, queda el paraje o el departamento", () => {
    assert.equal(textoDeDireccion({ hamlet: "Paso de los Mellizos", state: "Río Negro" })?.texto, "Paso de los Mellizos");
    assert.equal(textoDeDireccion({ state: "Durazno", country: "Uruguay" })?.texto, "Durazno");
});

test("una peatonal o un camino también son una calle", () => {
    assert.equal(textoDeDireccion({ pedestrian: "Peatonal Sarandí", suburb: "Ciudad Vieja", city: "Montevideo" })?.calle, "Peatonal Sarandí");
});

test("sin nada que decir no hay dirección", () => {
    assert.equal(textoDeDireccion({}), null);
    assert.equal(textoDeDireccion(null), null);
    assert.equal(textoDeDireccion({ country: "Uruguay" }), null);
    assert.equal(textoDeDireccion({ road: "  " }), null);
});

test("dos puntos a pocos metros comparten la clave; a una cuadra, no", () => {
    assert.equal(claveDeLugar(-34.889273, -56.143953), claveDeLugar(-34.889301, -56.143961));
    assert.notEqual(claveDeLugar(-34.889273, -56.143953), claveDeLugar(-34.890273, -56.143953));
    assert.equal(claveDeLugar(-34.9, -56.1), "-34.9000,-56.1000");
});

test("la geocerca manda y la dirección la ubica", () => {
    assert.equal(lugarConDireccion("en Base", "Cavour 3230, La Blanqueada, Montevideo"), "en Base · Cavour 3230");
    assert.equal(lugarConDireccion(null, "Cavour 3230, La Blanqueada, Montevideo"), "Cavour 3230, La Blanqueada, Montevideo");
    assert.equal(lugarConDireccion("a 300 m de Taller", null), "a 300 m de Taller");
    assert.equal(lugarConDireccion(null, null), null);
});

test("de varios números para una misma puerta va el primero", () => {
    assert.equal(textoDeDireccion({ road: "Cavour", house_number: "3232,3232 BIS", suburb: "Parque Batlle", city: "Montevideo" })?.texto, "Cavour 3232, Parque Batlle, Montevideo");
    assert.equal(textoDeDireccion({ road: "Félix Buxareo", house_number: "1104;1106" })?.calle, "Félix Buxareo 1104");
});
