/** El diagnóstico de imagen sobre cuadros sintéticos: tapada, borrosa y movida (21/10). */
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { medir, calce } from "@/lib/diagnostico-imagen";

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
/**
 * Una escena sin repeticiones (rectángulos de tamaños y grises distintos, siempre los mismos): el
 * tablero de arriba es periódico y, corrido un período, calza consigo mismo.
 */
async function calle(dx = 0, sombra = false) {
    const W = 640, H = 360, buf = Buffer.alloc(W * H * 3, 90);
    let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const rects = Array.from({ length: 40 }, () => ({ x: r() * W, y: r() * H, w: 20 + r() * 120, h: 20 + r() * 90, v: 30 + r() * 200 }));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const xx = x + dx; let v = 90;
        for (const q of rects) if (xx >= q.x && xx < q.x + q.w && y >= q.y && y < q.y + q.h) v = q.v;
        // La sombra de la tarde: la mitad derecha más oscura. Cambia el brillo, no el encuadre.
        if (sombra && x > W / 2) v *= 0.55;
        const i = (y * W + x) * 3; buf[i] = v; buf[i + 1] = v; buf[i + 2] = Math.min(255, v + 20);
    }
    return sharp(buf, { raw: { width: W, height: H, channels: 3 } }).jpeg().toBuffer();
}
test("diagnóstico: la misma escena calza sin correr, aunque cambie la luz", async () => {
    const ref = (await medir(await calle())).gris;
    const igual = calce(ref, (await medir(await calle())).gris);
    assert.ok(igual.cero > 0.9 && igual.dx === 0 && igual.dy === 0, JSON.stringify(igual));
    const sombra = calce(ref, (await medir(await calle(0, true))).gris);
    assert.ok(sombra.dx === 0 && sombra.dy === 0, `con sombra calzó corrida: ${JSON.stringify(sombra)}`);
});
test("diagnóstico: la escena corrida calza mejor corriéndola (cámara movida)", async () => {
    const ref = (await medir(await calle())).gris;
    const c = calce(ref, (await medir(await calle(25))).gris);
    assert.ok(Math.abs(c.dx) >= 2, JSON.stringify(c));
    assert.ok(c.mejor - c.cero >= 0.08, JSON.stringify(c));
});
