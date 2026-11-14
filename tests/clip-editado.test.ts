/** El texto que se dibuja sobre un clip (lib/clip-editado): sólo lo que la fuente tiene, en un renglón. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { paraDibujar } from "@/lib/clip-editado";

test("lo que Outfit no tiene no sale como un cuadradito", () => {
    assert.equal(paraDibujar("Ext. → Cairoli"), "Ext. -> Cairoli");
    assert.equal(paraDibujar("Portón 🚗 norte"), "Portón norte");
    assert.equal(paraDibujar("  02 - ENTRADA\n PROVEEDORES 1 "), "02 - ENTRADA PROVEEDORES 1");
    assert.equal(paraDibujar("sábado 14 de noviembre · 20:31:05"), "sábado 14 de noviembre · 20:31:05");
    assert.equal(paraDibujar("Ñandú «garita» – ¿año?"), "Ñandú «garita» – ¿año?");
    assert.equal(paraDibujar("🚗"), "");
});
