import { PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { getS3Client } from "@/lib/s3";
import { LADO_MAX, type Caja, type ClaseResumen, type FotoFila } from "@/lib/detector-propio";

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
