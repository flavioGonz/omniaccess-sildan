/**
 * De qué cuadro sale la cara (vision-rostros.js, 24/11): el principal de cuando la persona está más
 * cerca va primero; si ahí la cara no alcanza, se prueba el de más confianza y se queda la más
 * grande. Con el motor (CompreFace) y go2rtc de mentira: la «cara» que devuelve el motor mide la
 * décima parte del ancho de la imagen que recibe, así cada cuadro trae su tamaño de cara.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require("sharp");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const V = require("../vision-rostros.js");

const imagen = (lado: number): Promise<Buffer> => sharp({ create: { width: lado, height: lado, channels: 3, background: { r: 90, g: 90, b: 90 } } }).jpeg().toBuffer();

type Escrito = { details: string };

/** Un entorno con todo de mentira; `go2rtc` entrega en orden los cuadros de `principales`. */
async function entorno(principales: number[]) {
    const cuadros = await Promise.all(principales.map(imagen));
    const escritos: Escrito[] = [];
    const subidos: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, op?: { body?: FormData }) => {
        const u = String(url);
        if (u.includes("/api/frame.jpeg")) {
            const b = cuadros.shift();
            return { ok: !!b, status: b ? 200 : 404, arrayBuffer: async () => b };
        }
        if (u.includes("/recognition/recognize")) {
            const f = op?.body?.get("file") as Blob;
            const { width } = await sharp(Buffer.from(await f.arrayBuffer())).metadata();
            const px = Math.round((width || 0) / 10);
            return { ok: true, status: 200, json: async () => ({ result: [{ box: { x_min: 0, y_min: 0, x_max: px, y_max: px, probability: 0.99 }, subjects: [] }] }) };
        }
        // enrolar
        return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const prisma = {
        rostro: { create: async ({ data }: { data: Record<string, unknown> }) => ({ ...data, numero: 7, veces: 1 }), findUnique: async () => null },
        accessEvent: { create: async ({ data }: { data: Escrito }) => { escritos.push(data); return { id: "ev1", ...data }; } },
        rostroPasada: { findFirst: async () => null, create: async () => ({}) },
        user: { findFirst: async () => null, findUnique: async () => null },
    };
    const r = V.crear({
        prisma, log: () => {}, sharp, go2rtc: "http://go2rtc",
        bajar: async () => imagen(200), subir: async (k: string) => { subidos.push(k); }, borrar: async () => {}, emitir: () => {},
    });
    return { r, escritos, subidos, restaurar: () => { globalThis.fetch = real; } };
}

const AJUSTES = { moduloFace: true, faceCamaras: new Set(["cam"]), faceUrl: "http://motor", faceKey: "k", facePxMin: "80" };
const pista = () => ({ grupo: "persona", deviceId: "cam", camara: "Portero", foto: "2026-11-24/x-f.jpg", caja: [0, 0, 1, 1], ultimaVez: new Date("2026-11-24T12:00:00Z") }) as Record<string, unknown>;
const esperar = () => new Promise((ok) => setTimeout(ok, 30));
const caraPx = (d: string) => Number(/CaraPx: (\d+)/.exec(d)?.[1]);

test("crecer la caja pide otro cuadro principal; quedarse del mismo tamaño, no", async () => {
    const { r, restaurar } = await entorno([500, 700, 900]);
    try {
        const p = pista();
        r.cuadroMasCerca({ id: "cam" }, p, { caja_norm: [0.4, 0.4, 0.5, 0.6] }, AJUSTES); await esperar();
        assert.ok(p.hdCerca, "el primero se pide siempre");
        p.hdCercaT = 0; // el reloj no es lo que se prueba acá
        r.cuadroMasCerca({ id: "cam" }, p, { caja_norm: [0.4, 0.4, 0.51, 0.61] }, AJUSTES); await esperar();
        assert.ok(Math.abs(Number(p.hdCercaArea) - 0.02) < 1e-9, "no creció un 30 %: queda el primero");
        const antes = p.hdCerca;
        p.hdCercaT = 0;
        r.cuadroMasCerca({ id: "cam" }, p, { caja_norm: [0.3, 0.3, 0.5, 0.7] }, AJUSTES); await esperar();
        assert.notEqual(p.hdCerca, antes, "con el doble de área, otro cuadro");
        // Dentro del segundo no se pide aunque crezca: go2rtc no da uno por cuadro.
        const ultimo = p.hdCerca;
        r.cuadroMasCerca({ id: "cam" }, p, { caja_norm: [0, 0, 1, 1] }, AJUSTES); await esperar();
        assert.equal(p.hdCerca, ultimo);
    } finally { restaurar(); }
});

test("si la cara del cuadro más cercano alcanza, no se mira el otro", async () => {
    const { r, escritos, restaurar } = await entorno([]);
    try {
        const p = pista();
        p.hdCerca = { jpeg: await imagen(900), caja: [0, 0, 1, 1] };
        p.hdCara = { jpeg: await imagen(1200), caja: [0, 0, 1, 1] };
        await r.reconocer(p, AJUSTES);
        assert.equal(caraPx(escritos[0].details), 90);
        assert.equal(r.contadores.conCerca, 1);
        assert.match(escritos[0].details, /Identidad: nueva/);
    } finally { restaurar(); }
});

test("si no alcanza, se prueba el de más confianza y se queda la cara más grande", async () => {
    const { r, escritos, restaurar } = await entorno([]);
    try {
        const p = pista();
        p.hdCerca = { jpeg: await imagen(600), caja: [0, 0, 1, 1] };
        p.hdCara = { jpeg: await imagen(1000), caja: [0, 0, 1, 1] };
        await r.reconocer(p, AJUSTES);
        assert.equal(caraPx(escritos[0].details), 100);
        assert.equal(r.contadores.conCerca, 0);

        const q = pista();
        q.hdCerca = { jpeg: await imagen(700), caja: [0, 0, 1, 1] };
        q.hdCara = { jpeg: await imagen(500), caja: [0, 0, 1, 1] };
        await r.reconocer(q, AJUSTES);
        assert.equal(caraPx(escritos[1].details), 70, "el de confianza era peor: queda la del más cercano");
        assert.match(escritos[1].details, /SinIdentidad: cara chica \(70 px\)/);
        assert.match(escritos[1].details, /Escena: /, "la escena sale del cuadro principal elegido");
    } finally { restaurar(); }
});

test("sin cuadros principales, la cara sale del cuadro chico de la pista como antes", async () => {
    const { r, escritos, restaurar } = await entorno([]);
    try {
        await r.reconocer(pista(), AJUSTES);
        assert.equal(caraPx(escritos[0].details), 20);
        assert.doesNotMatch(escritos[0].details, /Escena: /);
    } finally { restaurar(); }
});
