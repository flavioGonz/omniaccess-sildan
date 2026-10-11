import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { getS3Client } from "@/lib/s3";
import { LADO_MAX, MODELOS_GUARDADOS, PARIDAD_MIN, type ArchivoModelo, type Caja, type ClaseResumen, type FotoFila } from "@/lib/detector-propio";

/** Setting con el detector propio activo (quién, cuándo, qué clases). */
const CLAVE_ACTIVO = "DETECTOR_PROPIO_ACTIVO";

/** El bucket del registro de visión: las fotos de entrenamiento son de las mismas cámaras. */
export const BUCKET = process.env.VISION_BUCKET || "objetos";
const CALIDAD = 90;

/** Guarda una foto (de cualquier formato) como JPEG con el lado mayor topado, y crea su fila. */
export async function guardarFoto(datos: Buffer, origen: "CAMARA" | "SUBIDA" | "REGISTRO", deviceId: string | null) {
    const img = sharp(datos, { failOn: "error" }).rotate();
    const jpeg = await img.resize({ width: LADO_MAX, height: LADO_MAX, fit: "inside", withoutEnlargement: true }).jpeg({ quality: CALIDAD }).toBuffer();
    const meta = await sharp(jpeg).metadata();
    const fila = await prisma.fotoEntrenamiento.create({ data: { clave: "", ancho: meta.width || 0, alto: meta.height || 0, origen, deviceId } });
    const clave = `entrenamiento/${new Date().toISOString().slice(0, 10)}/${fila.id}.jpg`;
    try {
        await (await getS3Client()).send(new PutObjectCommand({ Bucket: BUCKET, Key: clave, Body: jpeg, ContentType: "image/jpeg" }));
    } catch (e) {
        await prisma.fotoEntrenamiento.delete({ where: { id: fila.id } }).catch(() => null);
        throw e;
    }
    return prisma.fotoEntrenamiento.update({ where: { id: fila.id }, data: { clave } });
}

export async function resumenClases(): Promise<ClaseResumen[]> {
    const [clases, fotos] = await Promise.all([
        prisma.clasePropia.findMany({ orderBy: { createdAt: "asc" } }),
        prisma.fotoEntrenamiento.findMany({ where: { revisada: true }, select: { cajas: true } }),
    ]);
    const cajas = new Map<string, number>(), conFoto = new Map<string, number>();
    for (const f of fotos) {
        const vistas = new Set<string>();
        for (const c of (f.cajas as Caja[]) || []) { cajas.set(c.clase, (cajas.get(c.clase) || 0) + 1); vistas.add(c.clase); }
        for (const k of vistas) conFoto.set(k, (conFoto.get(k) || 0) + 1);
    }
    return clases.map((c) => ({ id: c.id, nombre: c.nombre, descripcion: c.descripcion, cajas: cajas.get(c.id) || 0, fotos: conFoto.get(c.id) || 0 }));
}

export async function filaFoto(f: any, camaras?: Map<string, string>): Promise<FotoFila> {
    return {
        id: f.id, url: `/api/vision/imagen/${f.clave}`, ancho: f.ancho, alto: f.alto, origen: f.origen, deviceId: f.deviceId,
        camara: f.deviceId ? camaras?.get(f.deviceId) ?? null : null, cajas: (f.cajas as Caja[]) || [], revisada: f.revisada, createdAt: f.createdAt.toISOString(),
    };
}

/**
 * El detector propio ACTIVO: el que omni-vision corre al lado del de fábrica. Vive en
 * entrenamientos/activo/ (montada en omni-vision como /propio, ver services/omni-vision/run.sh):
 * `modelo.onnx` y `modelo.json`. omni-vision mira la fecha de modelo.json cada 20 s y recarga;
 * por eso se escribe primero el ONNX y al final el json, y los dos con renombre (de una vez).
 */
const CARPETAS = process.env.ENTRENAMIENTOS_DIR || path.join(process.cwd(), "entrenamientos");
const ACTIVO = path.join(CARPETAS, "activo");
export type Activo = { entrenamiento: string; clases: { id: string; nombre: string }[]; umbral: number; activadoAt: string; activadoPor: string | null };

/**
 * Trae el ONNX de un entrenamiento a `destino`. Desde MinIO si se archivó (lo normal: el
 * entrenador no deja nada en el disco del CT); si no, de su carpeta de trabajo, que es donde queda
 * cuando la subida falló o el entrenamiento es anterior a la retención.
 */
async function traerModelo(t: { id: string; carpeta: string | null; resultado: any }, destino: string): Promise<void> {
    const a: ArchivoModelo | undefined = t.resultado?.archivo;
    if (a?.borradoAt) throw new Error(`Ese modelo ya se borró: se guardan los últimos ${MODELOS_GUARDADOS}.`);
    if (a?.clave) {
        const r = await (await getS3Client()).send(new GetObjectCommand({ Bucket: BUCKET, Key: a.clave })).catch((e) => {
            throw new Error(e?.name === "NoSuchKey" ? "El modelo no está en el almacenamiento (¿se borró a mano?)." : `No se pudo bajar el modelo: ${e?.message || e}`);
        });
        await pipeline(r.Body as Readable, fs.createWriteStream(destino));
        if (a.bytes && fs.statSync(destino).size !== a.bytes) throw new Error("El modelo bajó incompleto: no se activa.");
        return;
    }
    const local = path.join(t.carpeta || path.join(CARPETAS, t.id), "modelo.onnx");
    if (!fs.existsSync(local)) throw new Error("Ese entrenamiento no dejó un modelo.");
    fs.copyFileSync(local, destino);
}

export async function activar(t: { id: string; carpeta: string | null; resultado: any }, quien: string | null): Promise<Activo> {
    const r = t.resultado;
    if (!r?.ok) throw new Error("Ese entrenamiento no dejó un modelo.");
    if (r.paridad != null && r.paridad < PARIDAD_MIN) throw new Error("El modelo exportado no da lo mismo que el entrenado: no se activa.");
    fs.mkdirSync(ACTIVO, { recursive: true });
    const tmp = path.join(ACTIVO, ".modelo.onnx.tmp");
    try { await traerModelo(t, tmp); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
    fs.renameSync(tmp, path.join(ACTIVO, "modelo.onnx"));
    const meta = { entrenamiento: t.id, clases: r.clases, umbral: r.medicion?.umbral ?? 0.4, preproceso: r.preproceso, resolucion: r.resolucion };
    fs.writeFileSync(path.join(ACTIVO, ".modelo.json.tmp"), JSON.stringify(meta));
    fs.renameSync(path.join(ACTIVO, ".modelo.json.tmp"), path.join(ACTIVO, "modelo.json"));
    const activo: Activo = { entrenamiento: t.id, clases: r.clases.map((c: any) => ({ id: c.id, nombre: c.nombre })), umbral: meta.umbral, activadoAt: new Date().toISOString(), activadoPor: quien };
    await prisma.setting.upsert({ where: { key: CLAVE_ACTIVO }, update: { value: JSON.stringify(activo) }, create: { key: CLAVE_ACTIVO, value: JSON.stringify(activo) } });
    return activo;
}

/** Saca el detector propio: omni-vision lo suelta en su próxima mirada (≤ 20 s). */
export async function desactivar(): Promise<void> {
    for (const f of ["modelo.json", "modelo.onnx"]) fs.rmSync(path.join(ACTIVO, f), { force: true });
    await prisma.setting.deleteMany({ where: { key: CLAVE_ACTIVO } });
}

export async function activoActual(): Promise<Activo | null> {
    const s = await prisma.setting.findUnique({ where: { key: CLAVE_ACTIVO } });
    if (!s || !fs.existsSync(path.join(ACTIVO, "modelo.json"))) return null;
    try { return JSON.parse(s.value); } catch { return null; }
}
