import crypto from "crypto";
import sharp from "sharp";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { getS3Client } from "@/lib/s3";
import { getCompreFace } from "@/lib/compareface";

/*
 * Lo que el PANEL necesita del motor de rostros para fundar una identidad a mano: mirar una foto,
 * recortar la cara, enrolarla y dejar la fila (13/11, Nico: «subir una foto… cada rostro tendrá su
 * id único», «poder agregar un rostro conocido»).
 *
 * Es el mismo camino que recorre el proceso de visión (vision-rostros.js › mirar, recortesCara,
 * fundar) con los mismos márgenes y las mismas reglas (lib-rostros.js): una cara subida a mano y
 * una vista por una cámara terminan siendo la misma clase de identidad, con su número y su sujeto
 * `rostro-<id>` en el motor. No se comparte el archivo porque aquél es CommonJS con sus
 * dependencias inyectadas y corre en otro proceso; lo que sí se comparte es lib-rostros.js.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const R = require("../../lib-rostros.js") as {
    idDeSujeto: (s: string) => string | null; sujetoDe: (id: string) => string; codigo: (n: number) => string;
    umbrales: (a: { misma?: unknown; parecida?: unknown; padron?: unknown; pxMin?: unknown }) => Umbrales;
    decidir: (cara: { px: number; prob: number }, vecinos: Vecino[], u?: Umbrales) => Decision;
    VISITA_MS: number; EJEMPLOS_MAX: number; UMBRAL_MISMA: number; UMBRAL_PARECIDA: number; CARA_PX_MIN: number; CARA_PROB_MIN: number; ANONIMOS_DIAS: number;
};
export type Umbrales = { misma: number; parecida: number; padron: number; pxMin: number; probMin: number };
export type Vecino = { sujeto: string; similitud: number };
export type Decision =
    | { que: "padron"; sujeto: string; similitud: number }
    | { que: "misma"; rostroId: string; similitud: number }
    | { que: "nueva"; parecidaA?: string; parecido?: number }
    | { que: "sin-cara"; motivo: string };

export const BUCKET_ROSTROS = process.env.VISION_BUCKET || "objetos";
/** Los mismos márgenes que vision-rostros.js: el recorte que se enrola tiene que ser igual venga de donde venga. */
const MARGEN_CARA = 0.3;
const LADO_CARA = 320;
const MOTOR_MS = 12_000;
/** Lado máximo con que una foto subida se le da al motor: una foto de celular de 12 MP no hace falta entera. */
const LADO_SUBIDA = 1920;

export const claveFoto = (id: string) => `rostros/${id}.jpg`;
export const imagenRostro = (clave: string | null | undefined) => (clave ? `/api/vision/imagen/${clave}` : null);

type Caja = { x_min: number; y_min: number; x_max: number; y_max: number; probability?: number };
export type CaraVista = { caja: Caja; px: number; prob: number; vecinos: Vecino[] };

export async function motorRostros(ruta: string, op: { metodo?: string; jpeg?: Buffer } = {}): Promise<{ ok: boolean; estado: number; j: any }> {
    const { url, recoKey } = await getCompreFace();
    const init: RequestInit = { method: op.metodo || "POST", headers: { "x-api-key": recoKey }, signal: AbortSignal.timeout(MOTOR_MS) };
    if (op.jpeg) { const fd = new FormData(); fd.append("file", new Blob([new Uint8Array(op.jpeg)]), "f.jpg"); init.body = fd; }
    const r = await fetch(`${url}${ruta}`, init);
    return { ok: r.ok, estado: r.status, j: await r.json().catch(() => ({})) };
}
export const olvidarSujeto = (sujeto: string) => motorRostros(`/api/v1/recognition/subjects/${encodeURIComponent(sujeto)}`, { metodo: "DELETE" }).catch(() => null);
export const enrolar = (sujeto: string, jpeg: Buffer) => motorRostros(`/api/v1/recognition/faces?subject=${encodeURIComponent(sujeto)}&det_prob_threshold=0.5`, { jpeg });

/** Una foto subida, derecha (según su EXIF) y de un tamaño razonable, en JPEG. */
export async function normalizarFoto(original: Buffer): Promise<{ jpeg: Buffer; ancho: number; alto: number }> {
    const { data, info } = await sharp(original).rotate().resize({ width: LADO_SUBIDA, height: LADO_SUBIDA, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
    return { jpeg: data, ancho: info.width, alto: info.height };
}

/**
 * Las caras que el motor ve en la imagen, de la más grande a la más chica, con a quién se parece
 * cada una. `detMin` baja el piso de detección cuando ya se sabe que ahí hay una cara (el recorte
 * de una pasada que la compuerta dejó sin identidad).
 */
export async function mirarCaras(jpeg: Buffer, detMin = 0.7): Promise<CaraVista[]> {
    const r = await motorRostros(`/api/v1/recognition/recognize?det_prob_threshold=${detMin}&prediction_count=3`, { jpeg });
    // CompreFace contesta 400 «No face is found» cuando no hay cara: no es una falla del motor.
    if (!r.ok && r.estado !== 400) throw new Error(`El motor de rostros respondió ${r.estado}`);
    return ((r.j?.result || []) as any[]).filter((c) => c.box)
        .sort((a, b) => (b.box.y_max - b.box.y_min) - (a.box.y_max - a.box.y_min))
        .map((c) => ({
            caja: c.box, px: Math.round(c.box.y_max - c.box.y_min), prob: Number(c.box.probability) || 0,
            vecinos: ((c.subjects || []) as any[]).map((s) => ({ sujeto: String(s.subject), similitud: Number(s.similarity) || 0 })),
        }));
}

/** El recorte de la cara con aire: `nativa` para el motor (sin achicar), `chica` para mostrar. */
export async function recortesCara(jpeg: Buffer, caja: Caja): Promise<{ nativa: Buffer; chica: Buffer }> {
    const meta = await sharp(jpeg).metadata();
    const W = meta.width || 0, H = meta.height || 0;
    const bw = caja.x_max - caja.x_min, bh = caja.y_max - caja.y_min;
    const left = Math.max(0, Math.floor(caja.x_min - bw * MARGEN_CARA)), top = Math.max(0, Math.floor(caja.y_min - bh * MARGEN_CARA));
    const width = Math.max(1, Math.min(W - left, Math.ceil(bw * (1 + 2 * MARGEN_CARA))));
    const height = Math.max(1, Math.min(H - top, Math.ceil(bh * (1 + 2 * MARGEN_CARA))));
    const nativa = await sharp(jpeg).extract({ left, top, width, height }).jpeg({ quality: 92 }).toBuffer();
    const chica = await sharp(nativa).resize(LADO_CARA, LADO_CARA, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    return { nativa, chica };
}

/**
 * La cara de una pasada, vuelta a sacar de su ESCENA (el cuadro guardado) y de dónde estaba la
 * cara (fracciones del cuadro), agrandada `k` veces. Es para volver a mirar una pasada que quedó
 * sin identidad.
 *
 * Por qué no se usa el recorte de cara que ya está guardado: medido el 13/11 en el lab con las 17
 * pasadas sin identidad del día, el motor encontró la cara en 0 de 13 recortes guardados (son la
 * cara sola, de 21 a 132 px de lado: sin hombros ni fondo el detector no la ve), en 13 de 17
 * sacándola de la escena a tamaño real, y en 17 de 17 agrandándola al doble. Al triple, 16.
 */
export const AGRANDAR_ESCENA = 2;
export async function caraDeEscena(escena: Buffer, caja: [number, number, number, number], k = AGRANDAR_ESCENA): Promise<Buffer> {
    const m = await sharp(escena).metadata();
    const W = m.width || 0, H = m.height || 0;
    const bw = (caja[2] - caja[0]) * W, bh = (caja[3] - caja[1]) * H, cx = ((caja[0] + caja[2]) / 2) * W;
    // Dos caras y media a cada lado, una y media arriba y el resto abajo: la cabeza con los hombros.
    const left = Math.max(0, Math.round(cx - bw * 2.5)), top = Math.max(0, Math.round(caja[1] * H - bh * 1.5));
    const width = Math.max(1, Math.min(W - left, Math.round(bw * 5))), height = Math.max(1, Math.min(H - top, Math.round(bh * 5)));
    return sharp(escena).extract({ left, top, width, height }).resize({ width: Math.round(width * k), kernel: "lanczos3" }).jpeg({ quality: 92 }).toBuffer();
}

export async function subirRostro(clave: string, jpeg: Buffer) {
    await (await getS3Client()).send(new PutObjectCommand({ Bucket: BUCKET_ROSTROS, Key: clave, Body: jpeg, ContentType: "image/jpeg" }));
}
export async function bajarRostro(clave: string): Promise<Buffer | null> {
    try { const r = await (await getS3Client()).send(new GetObjectCommand({ Bucket: BUCKET_ROSTROS, Key: clave })); return Buffer.from(await r.Body!.transformToByteArray()); }
    catch { return null; }
}

/** Los umbrales vigentes: los Settings, dentro de los rangos de lib-rostros. */
export async function umbralesVigentes(): Promise<Umbrales & { anonimosDias: number }> {
    const leer = async (k: string) => (await prisma.setting.findUnique({ where: { key: k } }).catch(() => null))?.value ?? null;
    const [misma, parecida, padron, pxMin, dias] = await Promise.all([leer("FACE_UMBRAL_MISMA"), leer("FACE_UMBRAL_PARECIDA"), leer("FACE_UMBRAL"), leer("FACE_CARA_PX_MIN"), leer("FACE_ANONIMOS_DIAS")]);
    const d = Number(dias);
    return { ...R.umbrales({ misma, parecida, padron, pxMin }), anonimosDias: Number.isFinite(d) && d >= 1 && d <= 3650 ? Math.round(d) : R.ANONIMOS_DIAS };
}

/**
 * Funda una identidad con esta cara: la enrola en el motor, guarda su foto y deja la fila con su
 * número. Tira si el motor no la toma como cara. `nombre` la deja registrada de entrada.
 */
export async function fundarRostro(recortes: { nativa: Buffer; chica: Buffer }, datos: { px: number; cuando: Date; camara: string | null; parecidaA?: string | null; parecido?: number | null; apodo?: string | null; userId?: string | null }) {
    const id = "r" + crypto.randomBytes(12).toString("hex");
    const sujeto = R.sujetoDe(id);
    const r = await enrolar(sujeto, recortes.nativa);
    if (!r.ok) throw new Error(r.estado === 400 ? "El motor no encontró una cara en ese recorte: hace falta una foto más nítida o más de frente." : `El motor de rostros respondió ${r.estado} al enrolar.`);
    try {
        await subirRostro(claveFoto(id), recortes.chica);
        // La sugerencia de unir apunta a un Rostro: si el parecido era con alguien del padrón, al suyo.
        let parecidaA: string | null = null;
        if (datos.parecidaA) parecidaA = R.idDeSujeto(datos.parecidaA) || (await prisma.rostro.findUnique({ where: { sujeto: datos.parecidaA }, select: { id: true } }).catch(() => null))?.id || null;
        if (parecidaA && !(await prisma.rostro.findUnique({ where: { id: parecidaA }, select: { id: true } }))) parecidaA = null;
        return await prisma.rostro.create({
            data: {
                id, sujeto, foto: claveFoto(id), calidad: datos.px, primeraVez: datos.cuando, ultimaVez: datos.cuando, ultimaCamara: datos.camara,
                parecidaA, parecido: parecidaA ? datos.parecido ?? null : null, userId: datos.userId || null, apodo: datos.userId ? null : datos.apodo || null,
            },
        });
    } catch (e) {
        // Sin la fila, el sujeto quedaría en el motor reconociendo a alguien que la base no conoce.
        await olvidarSujeto(sujeto);
        throw e;
    }
}
