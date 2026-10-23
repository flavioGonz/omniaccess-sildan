/** La pared de Cámaras como VMS (openspec pared-vms): la foto del celular por QR y qué abre cada enlace. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { motivoDeRechazo, estadoDe, nuevoToken, hashToken, FORMA_TOKEN, SUBIDA_MAX_BYTES, SUBIDA_VIDA_MS } from "@/lib/monitor/subida";
import { alcanceCubre } from "@/lib/monitor/vistas";
import { claseDeApi } from "@/lib/permisos-api";

const ahora = new Date("2026-10-24T12:00:00Z");
const viva = { vence: new Date(ahora.getTime() + SUBIDA_VIDA_MS), llego: null };

test("subida: un código vivo acepta una foto", () => {
    assert.equal(motivoDeRechazo(viva, "image/jpeg", 300_000, ahora), null);
    assert.equal(motivoDeRechazo(viva, "image/png; charset=binary", 10, ahora), null);
});

test("subida: inexistente, vencido, usado, tipo, peso y vacío", () => {
    assert.equal(motivoDeRechazo(null, "image/jpeg", 10, ahora), "no-existe");
    assert.equal(motivoDeRechazo({ vence: ahora, llego: null }, "image/jpeg", 10, ahora), "vencido");
    assert.equal(motivoDeRechazo({ ...viva, llego: ahora }, "image/jpeg", 10, ahora), "usado");
    assert.equal(motivoDeRechazo(viva, "application/pdf", 10, ahora), "tipo");
    assert.equal(motivoDeRechazo(viva, "image/gif", 10, ahora), "tipo");
    assert.equal(motivoDeRechazo(viva, "image/jpeg", SUBIDA_MAX_BYTES + 1, ahora), "pesa");
    assert.equal(motivoDeRechazo(viva, "image/jpeg", 0, ahora), "vacia");
});

test("subida: lo que ve la pared", () => {
    assert.equal(estadoDe({ ...viva, retirada: null }, ahora), "esperando");
    assert.equal(estadoDe({ ...viva, llego: ahora, retirada: null }, ahora), "llego");
    assert.equal(estadoDe({ ...viva, llego: ahora, retirada: ahora }, ahora), "retirada");
    assert.equal(estadoDe({ vence: ahora, llego: null, retirada: null }, ahora), "vencido");
});

test("subida: el token tiene la forma que se acepta y el hash es estable", async () => {
    const { token, hash } = await nuevoToken();
    assert.match(token, FORMA_TOKEN);
    assert.equal(hash, await hashToken(token));
    assert.notEqual((await nuevoToken()).token, token);
});

test("alcance: buscar parecidos lo abren Cámaras y Rotación, no LPR", () => {
    for (const r of ["/api/monitor/camaras/buscar", "/api/monitor/camaras/imagen/2026-10-24/abc-r.jpg", "/api/monitor/camaras/subida", "/api/monitor/camaras/subida/xyz"]) {
        assert.ok(alcanceCubre("camaras", r), `camaras ${r}`);
        assert.ok(alcanceCubre("rotacion", r), `rotacion ${r}`);
        assert.ok(!alcanceCubre("lpr", r), `lpr ${r}`);
        assert.ok(!alcanceCubre("intrusion", r), `intrusion ${r}`);
    }
});

test("la subida del celular es pública por su propia regla", () => {
    assert.equal(claseDeApi("/api/subida/abc"), "propio");
});
