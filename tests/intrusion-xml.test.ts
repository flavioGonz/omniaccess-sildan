import test from "node:test";
import assert from "node:assert/strict";
import { tieneCentro, agregarCentro, nombreDeCanal, conNombreDeCanal, nombreVisible } from "@/lib/intrusion-xml";

// Recortes reales de una DS-2CD2T26G2-2I del lab (26/11).
const SOLO_GRABA = `<?xml version="1.0" encoding="UTF-8"?>
<EventTrigger version="2.0"><id>fielddetection-1</id><eventType>fielddetection</eventType><videoInputChannelID>1</videoInputChannelID>
<EventTriggerNotificationList>
<EventTriggerNotification><id>record-1</id><notificationMethod>record</notificationMethod><videoInputID>1</videoInputID><notificationRecurrence>beginning</notificationRecurrence></EventTriggerNotification>
</EventTriggerNotificationList>
</EventTrigger>`;

test("intrusión: sin «center» la cámara no le avisa a nadie", () => {
    assert.equal(tieneCentro(SOLO_GRABA), false);
});
test("intrusión: agregar el aviso al centro conserva los otros enlaces", () => {
    const x = agregarCentro(SOLO_GRABA);
    assert.equal(tieneCentro(x), true);
    assert.match(x, /<notificationMethod>record<\/notificationMethod>/, "la grabación sigue");
    assert.equal(agregarCentro(x), x, "dos veces no lo duplica");
});
test("intrusión: una lista vacía o ausente también recibe el aviso", () => {
    assert.equal(tieneCentro(agregarCentro("<EventTrigger><id>linedetection-1</id><EventTriggerNotificationList/></EventTrigger>")), true);
    assert.equal(tieneCentro(agregarCentro("<EventTrigger><id>linedetection-1</id></EventTrigger>")), true);
});
test("OSD: nombre del canal, cambiarlo y si se muestra", () => {
    const canal = `<VideoInputChannel version="2.0"><id>1</id><inputPort>1</inputPort><name>Sector 9 z3-z2 - c2</name><videoFormat>PAL</videoFormat></VideoInputChannel>`;
    assert.equal(nombreDeCanal(canal), "Sector 9 z3-z2 - c2");
    const nuevo = conNombreDeCanal(canal, "Fondo <lago> & z3");
    assert.equal(nombreDeCanal(nuevo), "Fondo <lago> & z3");
    assert.match(nuevo, /<videoFormat>PAL<\/videoFormat>/);
    assert.equal(nombreVisible("<VideoOverlay><channelNameOverlay><enabled>true</enabled><positionX>512</positionX></channelNameOverlay></VideoOverlay>"), true);
    assert.equal(nombreVisible("<VideoOverlay><channelNameOverlay><enabled>false</enabled></channelNameOverlay></VideoOverlay>"), false);
    assert.equal(nombreVisible("<VideoOverlay></VideoOverlay>"), null);
});

import { armarPasos } from "@/lib/intrusion-estado";
const base = { marca: "hikvision" as const, avisa: true, soporta: { linea: true, zona: true }, centro: { linea: true, zona: true }, servidor: { ok: true, omni: true, otros: 0 }, ultimoEvento: new Date().toISOString() };
const regla = (activa = true) => ({ id: 1, activa, puntos: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
test("cadena: sabe detectar pero no tiene nada dibujado", () => {
    const p = armarPasos({ ...base, lineas: [], zonas: [] });
    assert.equal(p[0].estado, "falta"); assert.equal(p[0].arreglo, "calibrar");
});
test("cadena: dibujada, sin servidor de alarmas → no llega nunca", () => {
    const p = armarPasos({ ...base, lineas: [regla()], zonas: [], servidor: { ok: true, omni: false, otros: 1 } });
    const s = p.find((x) => x.clave === "servidor")!;
    assert.equal(s.estado, "falta"); assert.equal(s.arreglo, "servidor");
});
test("cadena: la regla sin aviso al centro se marca y se puede arreglar", () => {
    const p = armarPasos({ ...base, lineas: [regla()], zonas: [regla()], centro: { linea: true, zona: false } });
    const c = p.find((x) => x.clave === "centro")!;
    assert.equal(c.estado, "falta"); assert.equal(c.titulo, "La zona no avisa al centro");
});
test("cadena: en Dahua no se pide servidor de alarma por cámara", () => {
    const p = armarPasos({ ...base, marca: "dahua", lineas: [regla()], zonas: [] });
    assert.equal(p.find((x) => x.clave === "servidor")!.estado, "no-aplica");
    assert.ok(!p.some((x) => x.clave === "centro"));
});
