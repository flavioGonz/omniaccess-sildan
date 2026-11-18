import test from "node:test";
import assert from "node:assert/strict";
import { direcciones, esSubredPrivada, leerRango, prefijoDe, queParece, subredesSugeridas } from "@/lib/descubrir-red";

test("sólo redes privadas", () => {
    for (const ok of ["192.168.1", "10.0.0", "172.26.20", "172.16.5", "172.31.255"]) assert.equal(esSubredPrivada(ok), true, ok);
    for (const no of ["8.8.8", "172.15.1", "172.32.1", "200.40.182", "192.169.1"]) assert.equal(esSubredPrivada(no), false, no);
});

test("un prefijo con cualquier cosa pegada no pasa", () => {
    for (const no of ["10.0.1;reboot", "10.0.1 2", "10.0.01", "10.0.-1", "10.0", "10.0.1.5", "10.0.1\n", ""]) {
        assert.equal(esSubredPrivada(no), false, JSON.stringify(no));
        assert.deepEqual(direcciones(no), []);
    }
});

test("la lista de direcciones se acota", () => {
    assert.deepEqual(direcciones("192.168.1", 10, 12), ["192.168.1.10", "192.168.1.11", "192.168.1.12"]);
    assert.equal(direcciones("192.168.1").length, 254);
    assert.equal(direcciones("192.168.1", 0, 999).length, 254);
    // Al revés: se corrige en vez de devolver nada.
    assert.deepEqual(direcciones("192.168.1", 20, 5), ["192.168.1.20"]);
});

test("las subredes sugeridas salen de los equipos que ya hay, la más poblada primero", () => {
    const r = subredesSugeridas(["192.168.1.7", "192.168.1.8", "172.26.20.19", null, "sin ip", "8.8.8.8"]);
    assert.deepEqual(r, ["192.168.1", "172.26.20"]);
});

test("la subred propia del servidor entra aunque no tenga equipos", () => {
    assert.deepEqual(subredesSugeridas(["192.168.1.7"], ["10.10.0"]), ["192.168.1", "10.10.0"]);
});

test("RTSP abierto es cámara o grabador, y la marca sale del encabezado", () => {
    const p = queParece({ puertos: [80, 554, 8000], servidor: "App-webs/", reino: "DS-2CD2143G0-I", nombre: null });
    assert.equal(p.marca, "HIKVISION");
    assert.match(p.que, /Cámara o grabador/);
    // No inventa el tipo: una cámara y un grabador se ven igual desde afuera.
    assert.equal(p.tipo, null);
});

test("un Akuvox con RTSP es un portero", () => {
    const p = queParece({ puertos: [80, 554], servidor: "Akuvox Embedded", reino: null, nombre: null });
    assert.equal(p.tipo, "DOOR_INTERCOM");
    assert.equal(p.marca, "AKUVOX");
});

test("el 37777 delata un grabador Dahua aunque no diga nada", () => {
    const p = queParece({ puertos: [80, 37777], servidor: null, reino: null, nombre: null });
    assert.equal(p.tipo, "NVR");
    assert.equal(p.marca, "DAHUA");
});

test("sin señales, dice que no sabe", () => {
    assert.equal(queParece({ puertos: [], servidor: null, reino: null, nombre: null }).que, "No se sabe");
    assert.equal(queParece({ puertos: [80], servidor: null, reino: null, nombre: null }).que, "Algo con página web");
});

test("prefijoDe", () => {
    assert.equal(prefijoDe("172.26.20.226"), "172.26.20");
    assert.equal(prefijoDe("8.8.8.8"), null);
    assert.equal(prefijoDe(null), null);
});

test("si contesta ISAPI es Hikvision, aunque no mande ningún encabezado (medido 17/11)", () => {
    const p = queParece({ puertos: [80, 443, 554, 8000], servidor: null, reino: "IP Camera(GB828)", nombre: null, habla: ["ISAPI"] });
    assert.equal(p.marca, "HIKVISION");
    assert.match(p.que, /Cámara IP/);
});

test("el reino separa cámara de grabador", () => {
    const g = queParece({ puertos: [80, 554], servidor: null, reino: "Embedded Net DVR", nombre: null, habla: ["ISAPI"] });
    assert.equal(g.tipo, "NVR");
    assert.match(g.que, /Grabador/);
});

test("magicBox contesta y ISAPI no: Dahua", () => {
    assert.equal(queParece({ puertos: [80, 554], servidor: null, reino: null, nombre: null, habla: ["DAHUA"] }).marca, "DAHUA");
});

test("el campo de red entiende las cuatro formas de escribirla", () => {
    assert.deepEqual(leerRango("192.168.1"), { subred: "192.168.1", desde: 1, hasta: 254, total: 254 });
    assert.deepEqual(leerRango("192.168.1.x"), { subred: "192.168.1", desde: 1, hasta: 254, total: 254 });
    assert.deepEqual(leerRango("192.168.1.0/24"), { subred: "192.168.1", desde: 1, hasta: 254, total: 254 });
    // Un /26 arranca en .64 y termina en .127; sin la red ni la difusión quedan .65–.126.
    assert.deepEqual(leerRango("192.168.1.100/26"), { subred: "192.168.1", desde: 65, hasta: 126, total: 62 });
    assert.deepEqual(leerRango("10.0.5.10-60"), { subred: "10.0.5", desde: 10, hasta: 60, total: 51 });
    assert.deepEqual(leerRango("172.20.3.17"), { subred: "172.20.3", desde: 17, hasta: 17, total: 1 });
});

test("un bloque más grande que una /24 se avisa, no se recorta solo", () => {
    const r = leerRango("10.0.0.0/22") as { error: string };
    assert.match(r.error, /1024 direcciones/);
});

test("el campo de red rechaza lo que no es una red privada", () => {
    assert.ok((leerRango("8.8.8.0/24") as { error: string }).error);
    assert.ok((leerRango("") as { error: string }).error);
    assert.ok((leerRango("la red de la entrada") as { error: string }).error);
});
