import crypto from "crypto";
import sharp from "sharp";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { getS3Client } from "@/lib/s3";
import { VISION_URL } from "@/lib/vision";
import { BUCKET, filaFoto, guardarFoto, nombresDeCamaras } from "@/lib/detector-propio-servidor";
import { deInt8, puntuar, type ModeloZona } from "@/lib/zona-entrenable";
import { fotosQueSirven, muestrasQueSirven, FUENTE_FOTO, TOPE_TRAER, type FotoDelConjunto } from "@/lib/fotos-compartidas";

/**
 * Las dos conversiones entre los dos conjuntos de entrenamiento (ver src/lib/fotos-compartidas.ts
 * para el porqué y las reglas; acá está el trabajo de verdad: bajar, recortar, pedir el vector).
 *
 * El recorte y la cuantización del vector salen de lib-zona-muestra.js, el mismo módulo que usa el
 * worker: una muestra traída de una foto tiene que ser indistinguible de una que tomó el vigía, o
 * el modelo entrenado la mide con otra vara.
 */
const M = require("../../lib-zona-muestra.js") as {
    recortarZona: (s: typeof sharp, jpeg: Buffer, zona: number[][]) => Promise<Buffer>;
    normalizar: (v: number[]) => number[];
    aInt8: (v: number[]) => { vector: Buffer; escala: number };
};

const TIEMPO_VISION_MS = 20_000;

const sigmoide = (z: number) => 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, z))));
const producto = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

async function bajar(clave: string): Promise<Buffer> {
    const r = await (await getS3Client()).send(new GetObjectCommand({ Bucket: BUCKET, Key: clave }));
    return Buffer.from(await r.Body!.transformToByteArray());
}

async function vectorDe(jpeg: Buffer): Promise<number[]> {
    const r = await fetch(`${VISION_URL()}/vector`, {
        method: "POST", body: new Uint8Array(jpeg), headers: { "content-type": "image/jpeg" },
        cache: "no-store", signal: AbortSignal.timeout(TIEMPO_VISION_MS),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !Array.isArray(j.vector)) throw new Error(j?.error || `omni-vision respondió ${r.status}`);
    return M.normalizar(j.vector);
}

/**
 * La probabilidad con las FRASES de la zona, para las que se traen cuando todavía no hay modelo
 * entrenado. Es la misma cuenta del worker (vision-zonas.js) y se pide una sola vez por tanda.
 *
 * Importa más de lo que parece: el etiquetado rápido trabaja con las «dudosas», que son las que
 * tienen probabilidad cerca del umbral. Sin este número, cuarenta fotos recién traídas a una zona
 * sin entrenar no aparecerían ahí — justo cuando más falta hace etiquetar.
 */
async function conFrases(frasesPositivo: string[], frasesNegativo: string[]): Promise<((v: number[]) => number) | null> {
    if (!frasesPositivo.length || !frasesNegativo.length) return null;
    try {
        const r = await fetch(`${VISION_URL()}/vector_texto`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ textos: [...frasesPositivo, ...frasesNegativo] }),
            cache: "no-store", signal: AbortSignal.timeout(TIEMPO_VISION_MS),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !Array.isArray(j.vectores)) return null;
        const vs: number[][] = j.vectores.map(M.normalizar);
        const pos = vs.slice(0, frasesPositivo.length), neg = vs.slice(frasesPositivo.length);
        const escala = Number(j.escala) || 100;
        const prom = (l: number[][], v: number[]) => l.reduce((s, t) => s + producto(t, v), 0) / l.length;
        return (v: number[]) => sigmoide(escala * (prom(pos, v) - prom(neg, v)));
    } catch { return null; }
}

/** Las fotos del conjunto que le sirven a esta zona y todavía no se trajeron. */
export async function fotosParaZona(zona: { id: string; deviceId: string }, tope = TOPE_TRAER): Promise<FotoDelConjunto[]> {
    const [fotos, traidas] = await Promise.all([
        prisma.fotoEntrenamiento.findMany({ where: { deviceId: zona.deviceId }, select: { id: true, deviceId: true, origen: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 2000 }),
        prisma.muestraZona.findMany({ where: { zonaId: zona.id, fotoId: { not: null } }, select: { fotoId: true } }),
    ]);
    return fotosQueSirven(
        fotos.map((f) => ({ id: f.id, deviceId: f.deviceId, origen: f.origen, createdAt: f.createdAt.toISOString() })),
        zona.deviceId, traidas.map((t) => t.fotoId as string), tope,
    );
}

/**
 * Trae fotos del conjunto de objetos como muestras de la zona: recorta cada una por la zona, le
 * pide el vector a omni-vision y la guarda sin etiquetar, para que caiga en el etiquetado.
 *
 * `prob` se calcula con el modelo VIGENTE si hay; sin modelo queda en null (con las frases habría
 * que pedirle a omni-vision el vector de cada frase, y eso es trabajo del worker). Null no rompe
 * nada: la pantalla recalcula la probabilidad con el modelo de hoy cuando lo hay.
 *
 * Una foto que falla no frena a las demás: se cuentan y se informan.
 */
export async function traerFotosAZona(zonaId: string, ids: string[] | null, tope = TOPE_TRAER): Promise<{ traidas: number; fallaron: number; motivo: string | null }> {
    const z = await prisma.zonaEntrenable.findUnique({ where: { id: zonaId }, select: { id: true, deviceId: true, zona: true, modelo: true, frasesPositivo: true, frasesNegativo: true } });
    if (!z) throw new Error("No existe esa analítica.");
    const candidatas = await fotosParaZona(z, tope);
    const elegidas = ids?.length ? candidatas.filter((f) => ids.includes(f.id)) : candidatas;
    if (!elegidas.length) return { traidas: 0, fallaron: 0, motivo: null };

    const filas = await prisma.fotoEntrenamiento.findMany({ where: { id: { in: elegidas.map((f) => f.id) } }, select: { id: true, clave: true } });
    const modelo = (z.modelo as ModeloZona | null) || null;
    const porFrases = modelo ? null : await conFrases(z.frasesPositivo, z.frasesNegativo);
    const zona = z.zona as number[][];
    let traidas = 0, fallaron = 0, motivo: string | null = null;
    for (const f of filas) {
        try {
            const recorte = await M.recortarZona(sharp, await bajar(f.clave), zona);
            const v = await vectorDe(recorte);
            const { vector, escala } = M.aInt8(v);
            const clave = `zonas/${z.id}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}.jpg`;
            await (await getS3Client()).send(new PutObjectCommand({ Bucket: BUCKET, Key: clave, Body: recorte, ContentType: "image/jpeg" }));
            await prisma.muestraZona.create({
                data: {
                    zonaId: z.id, recorte: clave, vector, escala, fotoId: f.id,
                    fuente: modelo ? "entrenado" : porFrases ? "frases" : FUENTE_FOTO,
                    prob: puntuar(modelo, deInt8(vector, escala)) ?? porFrases?.(v) ?? null,
                },
            });
            traidas++;
        } catch (e: any) {
            fallaron++; motivo = motivo || e?.message || "no se pudo";
        }
    }
    return { traidas, fallaron, motivo };
}

/**
 * Manda recortes de una zona al conjunto de entrenamiento de objetos, para dibujarles los
 * recuadros. Entran como origen ZONA (en la mezcla cuentan como foto de cámara: salieron de una).
 */
export async function mandarMuestrasAlConjunto(zonaId: string, ids: string[]): Promise<{ mandadas: number; repetidas: number; fallaron: number; motivo: string | null; fotos: any[] }> {
    const filas = await prisma.muestraZona.findMany({ where: { zonaId, id: { in: ids.slice(0, TOPE_TRAER) } }, select: { id: true, recorte: true, fotoId: true, zona: { select: { deviceId: true } } } });
    const sirven = muestrasQueSirven(filas.map((f) => ({ id: f.id, fotoId: f.fotoId })));
    const porId = new Map(filas.map((f) => [f.id, f]));
    const yaEstan = new Set((await prisma.fotoEntrenamiento.findMany({ where: { muestraId: { in: sirven.map((m) => m.id) } }, select: { muestraId: true } })).map((f) => f.muestraId as string));
    let mandadas = 0, fallaron = 0, motivo: string | null = null;
    const nuevas: any[] = [];
    for (const m of sirven) {
        if (yaEstan.has(m.id)) continue;
        const fila = porId.get(m.id)!;
        try {
            nuevas.push(await guardarFoto(await bajar(fila.recorte), "ZONA", fila.zona.deviceId, null, m.id));
            mandadas++;
        } catch (e: any) {
            fallaron++; motivo = motivo || e?.message || "no se pudo";
        }
    }
    const camaras = await nombresDeCamaras([...new Set(nuevas.map((f) => f.deviceId).filter(Boolean))] as string[]);
    return { mandadas, repetidas: filas.length - sirven.length + yaEstan.size, fallaron, motivo, fotos: await Promise.all(nuevas.map((f) => filaFoto(f, camaras))) };
}
