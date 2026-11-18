/** La doble verificación de rostros (lib/rostros-doble), con eventos reales de los dos lados. */
import test from "node:test";
import assert from "node:assert/strict";
import { emparejar, esNuestro, ladoEquipo, ladoNuestro, mismaPersona, resumen, veredictoDe } from "@/lib/rostros-doble";

const T = (s: string) => new Date(s);

/* Los dos de abajo son líneas reales: la nuestra la escribe vision-rostros.js y la del equipo
   lib/acs-importar, con la bitácora del DS-K1T343MFWX. */
const NUESTRO = {
    id: "n1", deviceId: "d1", timestamp: T("2026-11-18T17:00:10Z"), userId: null,
    details: "Rostro: Desconocido, Similitud: 25%, FaceImage: /api/vision/imagen/2026-11-18/359eda, Deteccion: 91%, RostroId: r9, Identidad: nueva, Source: OmniVision",
};
const DEL_EQUIPO = {
    id: "e1", deviceId: "d1", timestamp: T("2026-11-18T17:00:04Z"), userId: null,
    details: "Rostro reconocido · «Arquitecto Rodrigo» · legajo 1108 · #acs16272",
};

test("se sabe de qué lado viene cada evento", () => {
    assert.ok(esNuestro(NUESTRO), "lo nuestro va firmado Source: OmniVision");
    assert.ok(!esNuestro(DEL_EQUIPO));
});

test("de cada lado se lee a quién nombró", () => {
    const n = ladoNuestro(NUESTRO);
    assert.equal(n.nombre, "Desconocido"); assert.equal(n.similitud, 25);
    assert.equal(n.cara, "/api/vision/imagen/2026-11-18/359eda");
    const e = ladoEquipo(DEL_EQUIPO);
    assert.equal(e.nombre, "Arquitecto Rodrigo"); assert.equal(e.legajo, "1108");
});

test("el veredicto distingue los cinco casos", () => {
    const con = (nombre: string | null, legajo: string | null = null) => ({ id: "x", cuando: 0, nombre, legajo, userId: null, similitud: null, cara: null, detalle: null });
    assert.equal(veredictoDe(con("Rodrigo"), con("Rodrigo")), "coinciden");
    assert.equal(veredictoDe(con("Rodrigo"), con("Ana")), "discrepan");
    assert.equal(veredictoDe(con("Rodrigo"), con("Desconocido")), "solo-equipo");
    assert.equal(veredictoDe(null, con("Ana")), "solo-nosotros");
    assert.equal(veredictoDe(con("Desconocido"), con(null)), "nadie");
    // El equipo nombra por legajo («1108») y nosotros con el nombre que le pusimos: es el mismo.
    assert.ok(mismaPersona(con("1108", "1108"), con("Vecino 1108")));
});

test("cada evento se empareja una sola vez", () => {
    /* Dos pasadas del equipo seguidas y una sola captura nuestra: la captura va con la más
       cercana, y la otra queda como «solo-equipo». Sin esto, las dos se emparejaban con la misma
       y una decía «discrepan» sin que hubiera discrepancia. */
    const ev = [
        { id: "e1", deviceId: "d1", timestamp: T("2026-11-18T17:00:00Z"), details: "Rostro reconocido · «Ana» · #acs1" },
        { id: "e2", deviceId: "d1", timestamp: T("2026-11-18T17:00:15Z"), details: "Rostro reconocido · «Ana» · #acs2" },
        { id: "n1", deviceId: "d1", timestamp: T("2026-11-18T17:00:14Z"), details: "Rostro: Ana, Similitud: 88%, Source: OmniVision" },
    ];
    const pares = emparejar(ev);
    assert.equal(pares.length, 2);
    const conNuestro = pares.filter((p) => p.nuestro);
    assert.equal(conNuestro.length, 1, "la captura se usa una sola vez");
    assert.equal(conNuestro[0].equipo!.id, "e2", "va con la pasada más cercana");
    assert.equal(conNuestro[0].veredicto, "coinciden");
    assert.equal(pares.find((p) => p.equipo?.id === "e1")!.veredicto, "solo-equipo");
});

test("fuera de la ventana no se emparejan, y cada equipo va por su lado", () => {
    const ev = [
        { id: "e1", deviceId: "d1", timestamp: T("2026-11-18T17:00:00Z"), details: "Rostro reconocido · «Ana» · #acs1" },
        { id: "n1", deviceId: "d1", timestamp: T("2026-11-18T17:01:00Z"), details: "Rostro: Ana, Source: OmniVision" },
        { id: "n2", deviceId: "d2", timestamp: T("2026-11-18T17:00:01Z"), details: "Rostro: Ana, Source: OmniVision" },
    ];
    const pares = emparejar(ev);
    assert.equal(pares.length, 3, "un minuto después no es la misma pasada, y d2 es otro equipo");
    assert.ok(pares.every((p) => !(p.equipo && p.nuestro)));
});

test("el resumen cuenta el acuerdo sólo donde hablaron los dos", () => {
    const ev = [
        { id: "e1", deviceId: "d1", timestamp: T("2026-11-18T17:00:00Z"), details: "Rostro reconocido · «Ana» · #acs1" },
        { id: "n1", deviceId: "d1", timestamp: T("2026-11-18T17:00:02Z"), details: "Rostro: Ana, Source: OmniVision" },
        { id: "e2", deviceId: "d1", timestamp: T("2026-11-18T18:00:00Z"), details: "Rostro reconocido · «Beto» · #acs2" },
        { id: "n2", deviceId: "d1", timestamp: T("2026-11-18T18:00:02Z"), details: "Rostro: Carla, Source: OmniVision" },
        { id: "e3", deviceId: "d1", timestamp: T("2026-11-18T19:00:00Z"), details: "Rostro reconocido · «Dani» · #acs3" },
    ];
    const r = resumen(emparejar(ev));
    assert.equal(r.total, 3); assert.equal(r.coinciden, 1); assert.equal(r.discrepan, 1); assert.equal(r["solo-equipo"], 1);
    assert.equal(r.acuerdo, 50, "uno de los dos pares con las dos opiniones");
});
