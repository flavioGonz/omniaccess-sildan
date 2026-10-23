/** El diagnóstico de imagen sobre cuadros sintéticos: tapada, borrosa y movida (21/10). */
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { medir, correlacion } from "@/lib/diagnostico-imagen";

/** Un cuadro con bloques y bordes (una «escena»), desplazable. */
async function escena(dx = 0, borroso = false) {
    const W = 640, H = 360, buf = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const xx = x + dx, v = ((Math.floor(xx / 40) + Math.floor(y / 40)) % 2 ? 200 : 40) + ((xx * 7 + y * 13) % 23);
        const i = (y * W + x) * 3; buf[i] = v; buf[i + 1] = v; buf[i + 2] = Math.min(255, v + 30);
    }
    let img = sharp(buf, { raw: { width: W, height: H, channels: 3 } });
    if (borroso) img = img.blur(12);
    return img.jpeg().toBuffer();
}

test("diagnóstico: un cuadro negro no tiene variación (tapada)", async () => {
    const negro = await sharp({ create: { width: 640, height: 360, channels: 3, background: { r: 0, g: 0, b: 0 } } }).jpeg().toBuffer();
    const { medida } = await medir(negro);
    assert.ok(medida.desvio < 6, `desvío ${medida.desvio}`);
});
test("diagnóstico: el desenfoque baja mucho la nitidez", async () => {
    const a = await medir(await escena()), b = await medir(await escena(0, true));
    assert.ok(b.medida.nitidez < a.medida.nitidez * 0.35, `${b.medida.nitidez} contra ${a.medida.nitidez}`);
});
test("diagnóstico: la misma escena correlaciona alto; corrida, bajo", async () => {
    const a = await medir(await escena()), b = await medir(await escena()), c = await medir(await escena(100));
    assert.ok(correlacion(a.bordes, b.bordes) > 0.9);
    assert.ok(correlacion(a.bordes, c.bordes) < correlacion(a.bordes, b.bordes) - 0.2);
});
