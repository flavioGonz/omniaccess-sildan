import { test } from "node:test";
import assert from "node:assert/strict";
import { coincide, deClipGrabado, deDespachos, disimular, ordenarEvidencias, type FilaClip, type FilaDespacho } from "@/lib/evidencias";

const T = Date.UTC(2026, 10, 16, 15, 0, 0);
const clip = (mas: Partial<FilaClip> = {}): FilaClip => ({ id: "c1", usuario: "Nico", usuarioId: "u1", rotulo: null, nombre: "grabado_1.mp4", guardado: "/api/files/b/clips/2026-11/grabado_1.mp4", foto: "/api/files/b/clips/2026-11/grabado_1.jpg", segundos: 42, camaras: 2,
    tramos: [{ deviceId: "d1", desde: T - 60_000, hasta: T - 40_000, nombre: "Portón" }, { deviceId: "d2", desde: T - 40_000, hasta: T - 18_000, nombre: "Calle 2" }], creado: new Date(T - 30_000), terminado: new Date(T), ...mas });
const job = (id: string, mas: Partial<FilaDespacho>): FilaDespacho => ({ id, type: "CLIP", channel: "telegram", status: "SENT", payload: {}, deviceId: "d1", lastError: null, createdAt: new Date(T), ...mas });

test("un clip grabado en varias cámaras: el recorrido, y los envíos de ESE archivo", () => {
    const envio = job("j1", { type: "ALERT", channel: "whatsapp", payload: { evento: "compartido", clipHecho: "grabado_1.mp4", to: "59899123456", enviadoPor: "Nico" } });
    const otro = job("j2", { type: "ALERT", payload: { evento: "compartido", clipHecho: "otro.mp4", to: "1" } });
    const e = deClipGrabado(clip(), [envio, otro]);
    assert.equal(e.origen, "grabado");
    assert.equal(e.detalle, "Portón → Calle 2");
    assert.equal(e.instante, new Date(T - 60_000).toISOString());
    assert.deepEqual(e.envios.map((x) => [x.canal, x.a]), [["whatsapp", ["…3456"]]]);
    assert.equal(e.sinVideo, null);
    assert.ok(deClipGrabado(clip({ guardado: null }), []).sinVideo);
});

test("un clip mandado desde la grabación: con video si quedó guardado, y si no, se dice", () => {
    const viejo = job("a", { payload: { deviceName: "LPR Entrada", instante: new Date(T).toISOString(), ventana: { antes: 10, despues: 20 }, matricula: "SBX4521", destinatarios: [{ destino: "-100", nombre: "Guardia" }], enviadoPor: "Ana" } });
    const nuevo = job("b", { payload: { deviceName: "LPR Salida", guardado: "/api/files/b/clips/x.mp4", foto: "/api/files/b/clips/x.jpg", clip: "x.mp4", destinatarios: [{ telefono: "59899000111", nombre: "Juan" }] }, createdAt: new Date(T + 1000) });
    const fallo = job("c", { status: "FAILED", lastError: "sin video", payload: { deviceName: "Fondo" }, createdAt: new Date(T + 2000) });
    const [a, b, c] = deDespachos([viejo, nuevo, fallo]);
    assert.deepEqual([a.titulo, a.segundos, a.matricula, a.quien, a.envios[0].a], ["LPR Entrada", 30, "SBX4521", "Ana", ["Guardia"]]);
    assert.match(a.sinVideo!, /no quedó guardado/);
    assert.deepEqual([b.video, b.sinVideo, b.archivo], ["/api/files/b/clips/x.mp4", null, "x.mp4"]);
    assert.match(c.sinVideo!, /No salió/);
});

test("un evento compartido a tres destinos es UNA evidencia con tres envíos; las alertas de las reglas no son evidencia", () => {
    const base = { evento: "compartido", asunto: "Lectura SBX4521", instante: new Date(T).toISOString(), enviadoPor: "Ana", snapshotPath: "/api/files/b/f.jpg" };
    const r = deDespachos([
        job("1", { type: "ALERT", payload: { ...base, to: "59899000111" }, createdAt: new Date(T) }),
        job("2", { type: "ALERT", payload: { ...base, to: "59899000222" }, createdAt: new Date(T + 500) }),
        job("3", { type: "ALERT", payload: { ...base, to: "59899000333" }, createdAt: new Date(T + 900) }),
        job("4", { type: "ALERT", payload: { ruleName: "Lista negra", text: "alerta" } }),
        job("5", { type: "ALERT", payload: { ...base, to: "59899000111" }, createdAt: new Date(T + 3_600_000) }),
    ]);
    assert.equal(r.length, 2, "tres destinos juntos, y el mismo evento compartido una hora después es otro");
    assert.equal(r[0].envios.length, 3);
    assert.equal(r[0].foto, "/api/files/b/f.jpg");
});

test("el envío de un clip grabado que ya está en la lista no aparece dos veces", () => {
    const j = job("1", { type: "ALERT", payload: { evento: "compartido", clipHecho: "grabado_1.mp4", asunto: "Clip" } });
    assert.equal(deDespachos([j], new Set(["grabado_1.mp4"])).length, 0);
    assert.equal(deDespachos([j]).length, 1);
    // Mirando sólo lo enviado, ese envío aparece con el video del clip que mandó.
    const solo = deDespachos([j], new Set(), new Map([["grabado_1.mp4", { guardado: "/api/files/b/g.mp4", foto: "/api/files/b/g.jpg", segundos: 42 }]]))[0];
    assert.deepEqual([solo.video, solo.foto, solo.segundos, solo.sinVideo], ["/api/files/b/g.mp4", "/api/files/b/g.jpg", 42, null]);
    assert.match(deDespachos([j])[0].sinVideo!, /ya no está/);
});

test("de dónde salió: cada tramo con su cámara y su rato; y lo borrado de Evidencias ya no se lista", () => {
    const e = deClipGrabado(clip({ tramos: [{ nvrId: "n1", ch: 4, desde: T - 60_000, hasta: T - 40_000, nombre: "Portón" }, { deviceId: "d2", desde: T - 40_000, hasta: T - 18_000, nombre: "Calle 2" }] }), []);
    assert.deepEqual(e.fuentes.map((f) => [f.camara, f.nvrId, f.canal, f.deviceId]), [["Portón", "n1", 4, null], ["Calle 2", null, null, "d2"]]);
    assert.equal(e.fuentes[0].desde, new Date(T - 60_000).toISOString());
    const enviado = deDespachos([job("a", { payload: { deviceName: "LPR Entrada", instante: new Date(T).toISOString(), ventana: { antes: 10, despues: 20 }, fuente: "anillo" } })])[0];
    assert.deepEqual([enviado.fuentes[0].origen, enviado.fuentes[0].desde, enviado.fuentes[0].hasta, enviado.despachos], ["anillo", new Date(T - 10_000).toISOString(), new Date(T + 20_000).toISOString(), ["a"]]);
    assert.equal(deDespachos([job("b", { payload: { deviceName: "X", evidenciaBorrada: { por: "Nico" } } })]).length, 0);
    const tres = deDespachos(["1", "2", "3"].map((id, k) => job(id, { type: "ALERT", payload: { evento: "compartido", asunto: "A", instante: new Date(T).toISOString(), to: id }, createdAt: new Date(T + k * 100) })));
    assert.deepEqual(tres[0].despachos, ["1", "2", "3"]);
});

test("lo más nuevo primero, y se busca por cámara, persona, matrícula o destino", () => {
    const l = ordenarEvidencias([deClipGrabado(clip({ terminado: new Date(T - 5000) }), []), ...deDespachos([job("a", { payload: { deviceName: "LPR Entrada", matricula: "SBX4521", destinatarios: [{ nombre: "Guardia" }] } })])]);
    assert.deepEqual(l.map((e) => e.origen), ["enviado", "grabado"]);
    assert.ok(coincide(l[0], "sbx") && coincide(l[0], "guardia") && coincide(l[1], "portón") && coincide(l[1], "nico") && !coincide(l[1], "sbx"));
    assert.equal(disimular("59899123456"), "…3456");
});
