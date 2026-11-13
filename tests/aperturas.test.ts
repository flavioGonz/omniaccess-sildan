/** Las aperturas de un portero (lib/aperturas): leer lo que cada marca contesta sobre sus puertas. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rangoHikvision, paramHikvision, puertasHikvision, puertasDahua, comoAbre, COMO_ABRE, MARCAS_PORTERO, PUERTAS_MAXIMO, textoSegundos } from "@/lib/aperturas";

// Lo que contestó el DS-KB8113-IME1(B) de Otto el 13/11 (V2.2.60), tal cual.
const CAP_KB = `<?xml version="1.0" encoding="UTF-8"?> <RemoteControlDoor version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"> <doorNo min="1" max="1"/> <cmd opt="open,alwaysOpen,resume"/> </RemoteControlDoor >`;
const PARAM_KB = `<?xml version="1.0" encoding="UTF-8"?> <DoorParam version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"> <doorNo>1</doorNo> <enable>true</enable> <doorName>Door1</doorName> <openDuration>1</openDuration> <relayReverseEnabled>false</relayReverseEnabled> </DoorParam>`;

test("el portero de Otto declara una puerta, con su nombre, su tiempo y sus órdenes", () => {
    assert.deepEqual(rangoHikvision(CAP_KB), { desde: 1, hasta: 1, ordenes: ["open", "alwaysOpen", "resume"] });
    assert.deepEqual(paramHikvision(PARAM_KB), { nombre: "Door1", segundos: 1 });
    assert.deepEqual(puertasHikvision(CAP_KB, { 1: PARAM_KB }), [{ n: 1, nombre: "Door1", clase: "cerradura", segundos: 1, ordenes: ["open", "alwaysOpen", "resume"] }]);
});

test("una controladora de varias puertas: se listan todas, y la deshabilitada no se ofrece", () => {
    const cap = `<RemoteControlDoor><doorNo min="1" max="4"/><cmd opt="open,close,alwaysOpen,alwaysClose"/></RemoteControlDoor>`;
    const p = (n: number, on: boolean) => `<DoorParam><doorNo>${n}</doorNo><enable>${on}</enable><doorName>Acceso ${n}</doorName><openDuration>5</openDuration></DoorParam>`;
    const puertas = puertasHikvision(cap, { 1: p(1, true), 2: p(2, false), 3: null, 4: p(4, true) });
    assert.deepEqual(puertas.map((x) => x.n), [1, 3, 4]);
    // La 3 no contestó sus parámetros: se ofrece igual (el equipo la declara), con el nombre genérico.
    assert.equal(puertas[1].nombre, "Puerta 3");
    assert.equal(puertas[1].segundos, null);
    assert.equal(puertas[0].segundos, 5);
});

test("un equipo que declara cientos de puertas no hace preguntar por todas", () => {
    const r = rangoHikvision(`<RemoteControlDoor><doorNo min="1" max="256"/></RemoteControlDoor>`);
    assert.equal(r!.hasta, PUERTAS_MAXIMO);
    assert.deepEqual(r!.ordenes, []);
});

test("una respuesta que no es de puertas no inventa ninguna", () => {
    assert.equal(rangoHikvision("<ResponseStatus><statusCode>4</statusCode></ResponseStatus>"), null);
    assert.deepEqual(puertasHikvision("<html>404</html>", {}), []);
    assert.equal(paramHikvision("<ResponseStatus/>"), null);
    assert.equal(paramHikvision(null), null);
});

test("Dahua e Intelbras: una línea por dato, índice desde 0 y canal desde 1", () => {
    const texto = ["table.AccessControl[0].Name=Portón", "table.AccessControl[0].UnlockHoldInterval=2500", "table.AccessControl[0].State=Normal",
        "table.AccessControl[1].Name=", "table.AccessControl[1].UnlockHoldInterval=0", "otra.cosa[0].Name=x"].join("\r\n");
    assert.deepEqual(puertasDahua(texto), [
        { n: 1, nombre: "Portón", clase: "cerradura", segundos: 2.5, ordenes: [] },
        { n: 2, nombre: "Puerta 2", clase: "cerradura", segundos: null, ordenes: [] },
    ]);
    assert.deepEqual(puertasDahua("Error\r\nBad Request!"), []);
});

test("la tabla dice lo que hay: probado sólo donde se vio abrir", () => {
    for (const m of MARCAS_PORTERO) assert.ok(COMO_ABRE[m], `${m} sin entrada`);
    assert.equal(comoAbre("AKUVOX").probado, true);
    for (const m of ["HIKVISION", "DAHUA", "INTELBRAS"]) { assert.equal(comoAbre(m).puede, true); assert.equal(comoAbre(m).probado, false); }
    assert.equal(comoAbre("GRANDSTREAM").puede, false);
    // Una marca que no está en la tabla no abre, y lo dice.
    assert.equal(comoAbre("ZKTECO").puede, false);
    assert.equal(comoAbre(null).puede, false);
    assert.equal(textoSegundos(2.5), "2,5 s");
    assert.equal(textoSegundos(null), null);
});
