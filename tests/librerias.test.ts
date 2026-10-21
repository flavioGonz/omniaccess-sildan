/**
 * Pruebas de las librerías que, si se rompen, rompen algo en silencio (punto 4, 21/10).
 * Correr: node scripts/probar.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SIN_AREA, filtroDeAreas, pasaAreas, type DatosAreasHistorial } from "@/lib/filtro-areas";
import { esSoloLectura, cambiaAlgo, exigirEscritura } from "@/lib/solo-lectura";
import { cifrarDato, descifrarDato, estaCifrado, descifrarProfundo, middlewareCifrado } from "@/lib/cifrado-datos";

const AREAS: DatosAreasHistorial = {
    areas: [
        { id: "otto", nombre: "Otto Villa", padre: null, color: "#000", nivel: 0, camaras: ["Portón", "Cerco"] },
        { id: "porton", nombre: "Portones", padre: "otto", color: "#000", nivel: 1, camaras: ["Portón"] },
        { id: "sn", nombre: "San Nicolás", padre: null, color: "#000", nivel: 0, camaras: ["LPR Entrada"] },
    ],
    asignadas: ["Portón", "Cerco", "LPR Entrada"],
};

test("filtro de áreas: un área trae sus cámaras", () => {
    const f = filtroDeAreas(["otto"], AREAS);
    assert.ok(pasaAreas(f, "Portón")); assert.ok(pasaAreas(f, "Cerco"));
    assert.ok(!pasaAreas(f, "LPR Entrada")); assert.ok(!pasaAreas(f, "RTSP suelta"));
});
test("filtro de áreas: «Sin área» es lo que no está en ninguna", () => {
    const f = filtroDeAreas([SIN_AREA], AREAS);
    assert.ok(pasaAreas(f, "RTSP suelta")); assert.ok(!pasaAreas(f, "Portón"));
});
test("filtro de áreas: sin elegir no filtra", () => {
    assert.equal(filtroDeAreas([], AREAS), null);
    assert.ok(pasaAreas(null, "cualquiera"));
});

test("sólo lectura: la red marcada no se escribe, el resto sí", () => {
    process.env.OMNI_EQUIPOS_SOLO_LECTURA = "192.168.1.0/24";
    assert.ok(esSoloLectura("192.168.1.86")); assert.ok(esSoloLectura("http://192.168.1.86:8080/x"));
    assert.ok(!esSoloLectura("10.1.10.55"));
    assert.throws(() => exigirEscritura("192.168.1.86", "PUT", "/ISAPI/Smart/LineDetection/1"));
    assert.doesNotThrow(() => exigirEscritura("192.168.1.86", "GET", "/ISAPI/System/deviceInfo"));
    assert.doesNotThrow(() => exigirEscritura("10.1.10.55", "PUT", "/ISAPI/Smart/LineDetection/1"));
});
test("sólo lectura: POST de búsqueda y el lente pasan; un PUT de configuración no", () => {
    assert.ok(!cambiaAlgo("POST", "/ISAPI/ContentMgmt/search"));
    assert.ok(!cambiaAlgo("PUT", "/ISAPI/PTZCtrl/channels/1/continuous"));
    assert.ok(cambiaAlgo("PUT", "/ISAPI/Streaming/channels/dualVCA"));
    assert.ok(cambiaAlgo("DELETE", "/ISAPI/Event/notification/httpHosts/1"));
});

test("cifrado: ida y vuelta, y lo viejo en claro se lee igual", () => {
    const c = cifrarDato("Clave123!");
    assert.ok(estaCifrado(c)); assert.notEqual(c, cifrarDato("Clave123!"), "cada cifrado lleva su IV");
    assert.equal(descifrarDato(c), "Clave123!");
    assert.equal(descifrarDato("en claro"), "en claro");
});
test("cifrado: al leer, se descifra a cualquier profundidad y sólo password / rtspUrl", () => {
    const fila = { name: "x", password: cifrarDato("p"), central: { device: { rtspUrl: cifrarDato("rtsp://u:p@h/1") } }, otro: cifrarDato("no se toca") };
    descifrarProfundo(fila);
    assert.equal(fila.password, "p"); assert.equal(fila.central.device.rtspUrl, "rtsp://u:p@h/1");
    assert.ok(estaCifrado(fila.otro));
});
test("cifrado: el middleware cifra al escribir un Device sin tocar el objeto de quien llama", async () => {
    const mw = middlewareCifrado();
    const datos = { name: "Cam", password: "secreta" };
    let guardado: any = null;
    const r = await mw({ model: "Device", action: "create", args: { data: datos } }, async (p: any) => { guardado = p.args.data; return { ...p.args.data }; });
    assert.ok(estaCifrado(guardado.password), "en la base va cifrada");
    assert.equal(datos.password, "secreta", "el que llama la sigue teniendo en claro");
    assert.equal(r.password, "secreta", "y al leerla vuelve en claro");
});
test("cifrado: el upsert cifra create y update; otro modelo no se toca", async () => {
    const mw = middlewareCifrado();
    let args: any = null;
    await mw({ model: "Device", action: "upsert", args: { where: { id: "1" }, create: { password: "a" }, update: { password: { set: "b" } } } }, async (p: any) => { args = p.args; return null; });
    assert.ok(estaCifrado(args.create.password)); assert.ok(estaCifrado(args.update.password.set));
    await mw({ model: "User", action: "create", args: { data: { password: "hash" } } }, async (p: any) => { args = p.args; return null; });
    assert.equal(args.data.password, "hash");
});
