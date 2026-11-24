import test from "node:test";
import assert from "node:assert/strict";
import { esOrigenLocal, limpiarOrigen, origenDelPedido } from "@/lib/origen-publico";

const enc = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

test("origen: lo que sólo existe adentro del servidor nunca va en un enlace (25/11: salió localhost)", () => {
    for (const o of ["https://localhost:10001", "http://127.0.0.1:10001", "http://10.0.0.5", "http://192.168.1.10", "http://172.26.20.121", "http://omniaccess", "http://lab.local"]) assert.ok(esOrigenLocal(o), o);
    for (const o of ["https://omniaccess.ies.com.uy", "http://172.32.0.1", "https://sannicolas.com.uy"]) assert.ok(!esOrigenLocal(o), o);
});
test("origen: se limpia a protocolo y host", () => {
    assert.equal(limpiarOrigen("https://omniaccess.ies.com.uy/registro/"), "https://omniaccess.ies.com.uy");
    assert.equal(limpiarOrigen("omniaccess.ies.com.uy"), "https://omniaccess.ies.com.uy");
    assert.equal(limpiarOrigen("https://localhost:10001"), null);
    assert.equal(limpiarOrigen("javascript:alert(1)"), null);
    assert.equal(limpiarOrigen(""), null);
});
test("origen: del pedido vale el host que escribió el navegador, no el del proceso", () => {
    assert.equal(origenDelPedido(enc({ host: "localhost:10001", "x-forwarded-host": "omniaccess.ies.com.uy", "x-forwarded-proto": "https" })), "https://omniaccess.ies.com.uy");
    assert.equal(origenDelPedido(enc({ host: "omniaccess.ies.com.uy" })), "https://omniaccess.ies.com.uy");
    assert.equal(origenDelPedido(enc({ host: "localhost:10001" })), null, "si el proxy no pasa el host, no se inventa uno");
});
