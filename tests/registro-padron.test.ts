import test from "node:test";
import assert from "node:assert/strict";
import { normalizarLote, normalizarTelefono, puntoSirve, resumenDeSolicitud, validarSolicitud, VEHICULOS_MAX } from "@/lib/registro-padron";

const base = { lote: "B4", apellido: "Pérez", telefono: "099123456", tenencia: "PROPIETARIO" };

test("el lote se guarda igual lo escriba como lo escriba", () => {
    for (const x of ["b 4", "B4", "Lote B4", " lote  b4 "]) assert.equal(normalizarLote(x), "B4", x);
    assert.equal(normalizarLote("12"), "12");
    assert.equal(normalizarLote(""), "");
});

test("el teléfono queda como lo manda WhatsApp", () => {
    assert.equal(normalizarTelefono("099 123 456"), "59899123456");
    assert.equal(normalizarTelefono("+598 99 123 456"), "59899123456");
    assert.equal(normalizarTelefono(""), "");
});

test("sin lote, apellido o teléfono no se guarda nada", () => {
    const r = validarSolicitud({ ...base, lote: "", apellido: "", telefono: "" });
    assert.equal(r.datos, null);
    assert.equal(r.errores.length, 3);
});

test("un teléfono que no es uruguayo se avisa", () => {
    assert.match(validarSolicitud({ ...base, telefono: "1234" }).errores[0], /uruguayo/);
});

test("las matrículas se guardan derechas, en mayúsculas y sin espacios", () => {
    const r = validarSolicitud({ ...base, vehiculos: [{ chapa: " sbo 1234 ", tipo: "PROPIO" }] });
    assert.equal(r.datos?.vehiculos[0].chapa, "SBO1234");
});

test("a una persona NO se le corrige la chapa en silencio: se le pregunta", () => {
    // La cámara adivina desde píxeles y corrige; quien escribe su propia chapa, no. «sb0i234»
    // entraría como SBOI234 (molde paraguayo, un cambio): guardarla así es guardar otra chapa.
    const r = validarSolicitud({ ...base, vehiculos: [{ chapa: "sb0i234" }] });
    assert.equal(r.datos, null);
    assert.match(r.errores[0], /¿«sb0i234» es SBOI234\?/);
});

test("lo que no tiene forma de matrícula se rechaza con la persona delante", () => {
    const r = validarSolicitud({ ...base, vehiculos: [{ chapa: "el auto de mi suegra" }] });
    assert.equal(r.datos, null);
    assert.match(r.errores[0], /no tiene forma de matrícula/);
});

test("la misma matrícula dos veces se avisa", () => {
    const r = validarSolicitud({ ...base, vehiculos: [{ chapa: "SBO1234" }, { chapa: "sbo 1234" }] });
    assert.match(r.errores[0], /está dos veces/);
});

test("las filas de vehículo vacías se ignoran, no molestan", () => {
    const r = validarSolicitud({ ...base, vehiculos: [{ chapa: "SBO1234" }, { chapa: "" }, { chapa: "   " }] });
    assert.equal(r.datos?.vehiculos.length, 1);
});

test("hay un tope de vehículos: más que eso es una flota, no una casa", () => {
    const muchos = Array.from({ length: VEHICULOS_MAX + 5 }, (_, i) => ({ chapa: `ABC${String(1000 + i)}` }));
    assert.equal(validarSolicitud({ ...base, vehiculos: muchos }).datos?.vehiculos.length, VEHICULOS_MAX);
});

test("un servicio con día y hora queda completo; uno vacío se ignora", () => {
    const r = validarSolicitud({
        ...base,
        servicios: [
            { tipo: "JARDINERO", nombre: "Ramón", dias: ["mar", "vie", "xxx"], desde: "08:00", hasta: "12:00" },
            { tipo: "OTRO", nombre: "", dias: [] },
        ],
    });
    assert.equal(r.datos?.servicios.length, 1);
    assert.deepEqual(r.datos?.servicios[0].dias, ["mar", "vie"]);
    assert.equal(r.datos?.servicios[0].desde, "08:00");
});

test("un horario mal escrito se avisa", () => {
    const r = validarSolicitud({ ...base, servicios: [{ tipo: "PISCINERO", dias: ["lun"], desde: "25:99" }] });
    assert.match(r.errores.join(" "), /horario/);
});

test("el resumen de la bandeja", () => {
    assert.equal(resumenDeSolicitud({ lote: "B4", apellido: "Pérez", vehiculos: [1, 2, 3] as any, servicios: [1] as any }), "Lote B4 · Pérez · 3 vehículos · 1 servicio");
});

test("el punto del lote: lo que sirve y lo que no", () => {
    assert.deepEqual(puntoSirve(-34.901123456, -56.164598765), { lat: -34.901123, lng: -56.164599 });
    // Lo que manda un navegador cuando el permiso se negó, o una isla del Golfo de Guinea.
    assert.equal(puntoSirve(0, 0), null);
    assert.equal(puntoSirve(95, -56), null);
    assert.equal(puntoSirve("acá", -56), null);
    assert.equal(puntoSirve(undefined, undefined), null);
});

test("una ubicación que no se entiende no tumba la carga", () => {
    const r = validarSolicitud({ ...base, lat: 0, lng: 0 });
    assert.deepEqual(r.errores, []);
    assert.equal(r.datos?.lat, null);
});

test("la ubicación viaja con la carga", () => {
    const r = validarSolicitud({ ...base, lat: -34.9011, lng: -56.1645 });
    assert.equal(r.datos?.lat, -34.9011);
    assert.equal(r.datos?.lng, -56.1645);
});
