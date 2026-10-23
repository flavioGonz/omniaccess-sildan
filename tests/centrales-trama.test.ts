/** La trama explicada por partes (lib/centrales/trama-partes). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { partesTrama } from "@/lib/centrales/trama-partes";

const unir = (xs: { texto: string }[]) => xs.map((x) => x.texto).join("");
test("las partes vuelven a armar la trama, sin perder ni sumar nada", () => {
    for (const t of ['14C70078"*ADM-CID"2348R1L1#9001[A1BB333B5515062C23944FE73B8DF2C]', 'ABCD0040"ADM-CID"0005R1L1#9001[#9001|1130 01 003]_12:00:00,10-22-2026', "5015 182989E13001010", "15 2989 18 E130 01 U020", "Q015 580076c4250fE30600001", "QUE ES ESTO"])
        assert.equal(unir(partesTrama(t)), t, t);
});
test("DC-09 cifrada: cuenta y datos cifrados reconocidos", () => {
    const x = partesTrama('14C70078"*ADM-CID"2348R1L1#9001[A1BB]');
    assert.ok(x.some((p) => p.rotulo === "Cuenta" && p.texto === "#9001"));
    assert.ok(x.some((p) => p.tono === "cifrado"));
    assert.match(x.find((p) => p.rotulo === "Protocolo")!.ayuda, /CIFRADO/);
});
test("Sur-Gard e IPC10: cuenta, código y zona", () => {
    const sg = partesTrama("5015 182989E13001010");
    assert.equal(sg.find((p) => p.rotulo === "Cuenta")!.texto, "2989");
    assert.equal(sg.find((p) => p.rotulo === "Código de evento")!.texto, "130");
    assert.equal(sg.find((p) => p.rotulo === "Zona o usuario")!.texto, "010");
    const dg = partesTrama("15 2989 18 E130 01 U020");
    assert.equal(dg.find((p) => p.rotulo === "Zona o usuario")!.texto, "U020");
});
test("lo desconocido no se explica", () => assert.equal(partesTrama("QUE ES ESTO")[0].rotulo, "Sin reconocer"));
