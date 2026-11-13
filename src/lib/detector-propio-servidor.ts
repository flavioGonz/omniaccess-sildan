import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { getS3Client } from "@/lib/s3";
import { registrarCanalNvr } from "@/lib/go2rtc-sync";
import { LADO_MAX, MODELOS_GUARDADOS, PARIDAD_MIN, type ArchivoModelo, type Caja, type ClaseResumen, type FotoFila } from "@/lib/detector-propio";

/** Setting con el detector propio activo (quién, cuándo, qué clases). */
const CLAVE_ACTIVO = "DETECTOR_PROPIO_ACTIVO";

/** El bucket del registro de visión: las fotos de entrenamiento son de las mismas cámaras. */
export const BUCKET = process.env.VISION_BUCKET || "objetos";
const CALIDAD = 90;

/** Guarda una foto (de cualquier formato) como JPEG con el lado mayor topado, y crea su fila. */
export async function guardarFoto(datos: Buffer, origen: "CAMARA" | "SUBIDA" | "REGISTRO", deviceId: string | null, programaId: string | null = null) {
    const img = sharp(datos, { failOn: "error" }).rotate();
    const jpeg = await img.resize({ width: LADO_MAX, height: LADO_MAX, fit: "inside", withoutEnlargement: true }).jpeg({ quality: CALIDAD }).toBuffer();
    const meta = await sharp(jpeg).metadata();
    const fila = await prisma.fotoEntrenamiento.create({ data: { clave: "", ancho: meta.width || 0, alto: meta.height || 0, origen, deviceId, programaId } });
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
    return clases.map((c) => ({ id: c.id, nombre: c.nombre, descripcion: c.descripcion, cajas: cajas.get(c.id) || 0, fotos: conFoto.get(c.id) || 0, icono: c.icono, umbralPantalla: c.umbralPantalla }));
}

export async function filaFoto(f: any, camaras?: Map<string, string>): Promise<FotoFila> {
    return {
        id: f.id, url: `/api/vision/imagen/${f.clave}`, ancho: f.ancho, alto: f.alto, origen: f.origen, deviceId: f.deviceId,
        camara: f.deviceId ? camaras?.get(f.deviceId) ?? null : null, cajas: (f.cajas as Caja[]) || [], revisada: f.revisada, createdAt: f.createdAt.toISOString(),
        programada: !!f.programaId,
    };
}

const GO2RTC = process.env.GO2RTC_API || "http://127.0.0.1:1984";
const TIEMPO_CUADRO_MS = 8000;
const CUADRO_MIN_BYTES = 1000;
/**
 * Un canal de NVR que no es equipo, con el mismo nombre que su stream de go2rtc
 * (`lpr_nvrch-<nvr>-<ch>`). Pedido 15/10: «debo poder elegir las cámaras incluso de los NVR» —
 * el selector sólo listaba equipos, y en San Nicolás casi todas las cámaras son canales de NVR.
 * Se guarda así en FotoEntrenamiento.deviceId (texto libre) para saber de dónde salió la foto.
 */
export const CANAL_NVR = /^nvrch-([\w-]+)-(\d{1,4})$/;

/**
 * El cuadro de este momento de una cámara, del stream PRINCIPAL (go2rtc «_hd») y, si no sale, del
 * secundario: para entrenar se quiere la resolución entera, no el substream del registro.
 *
 * Es el único camino para tomar la foto de una cámara: lo usan «Sacar foto ahora» y la vuelta de
 * una programación (capturas-programadas-servidor.ts). Estaba escrito adentro de la ruta; con dos
 * que lo necesitan, dos copias se iban a separar el día que cambie cómo se elige el stream.
 */
export async function cuadroDeCamara(camara: string): Promise<{ bytes: Buffer; deviceId: string } | { error: string; status: number }> {
    const canal = CANAL_NVR.exec(camara);
    if (canal) {
        // El stream del canal vive en la memoria de go2rtc: se asegura antes de pedir el cuadro.
        if (!(await registrarCanalNvr(canal[1], Number(canal[2])))) return { error: "No existe ese NVR", status: 404 };
    } else if (!(await prisma.device.findUnique({ where: { id: camara }, select: { id: true } }))) {
        return { error: "No existe esa cámara", status: 404 };
    }
    for (const src of [`lpr_${camara}_hd`, `lpr_${camara}`]) {
        try {
            const r = await fetch(`${GO2RTC}/api/frame.jpeg?src=${encodeURIComponent(src)}`, { cache: "no-store", signal: AbortSignal.timeout(TIEMPO_CUADRO_MS) });
            if (!r.ok) continue;
            const b = Buffer.from(await r.arrayBuffer());
            if (b.length > CUADRO_MIN_BYTES) return { bytes: b, deviceId: camara };
        } catch { /* la siguiente fuente */ }
    }
    return { error: "go2rtc no entregó un cuadro de esa cámara", status: 502 };
}

/** El nombre de cada cámara por su id. Los canales de NVR se nombran por su grabador y su número: «NVR 2 · CH 3». */
export async function nombresDeCamaras(ids: string[]): Promise<Map<string, string>> {
    const nvrDe = new Map(ids.map((id) => [id, CANAL_NVR.exec(id)]).filter(([, m]) => m) as [string, RegExpExecArray][]);
    const buscar = [...new Set([...ids, ...[...nvrDe.values()].map((m) => m[1])])];
    const nombres = new Map((buscar.length ? await prisma.device.findMany({ where: { id: { in: buscar } }, select: { id: true, name: true } }) : []).map((d) => [d.id, d.name]));
    return new Map(ids.map((id) => { const m = nvrDe.get(id); return [id, m ? `${nombres.get(m[1]) || m[1]} · CH ${m[2]}` : nombres.get(id) || ""] as [string, string]; }).filter(([, n]) => n));
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

/**
 * Borrar un entrenamiento terminado: su modelo archivado, su carpeta de trabajo y la fila.
 *
 * Los entrenamientos de prueba (conjunto chico, cancelados, fallidos) se acumulaban en la lista
 * sin forma de sacarlos. El que está EN USO no se borra: primero hay que dejar de usarlo, porque
 * omni-vision lo está corriendo y la lista es la única forma de volver a él. Lo que no se pudo
 * borrar del almacenamiento o del disco no frena el borrado de la fila: se informa.
 */
export async function borrarEntrenamiento(id: string): Promise<{ ok: true; avisos: string[] } | { ok: false; error: string; estado?: number }> {
    const t = await prisma.entrenamientoDetector.findUnique({ where: { id } });
    if (!t) return { ok: false, error: "No existe ese entrenamiento", estado: 404 };
    if (["EN_COLA", "PREPARANDO", "ENTRENANDO", "EXPORTANDO"].includes(t.estado)) return { ok: false, error: "Está en curso: primero cancelalo.", estado: 409 };
    const activo = await activoActual().catch(() => null);
    if (activo?.entrenamiento === id) return { ok: false, error: "Es el modelo que están usando las cámaras: primero dejá de usarlo.", estado: 409 };
    const avisos: string[] = [];
    const a: ArchivoModelo | undefined = (t.resultado as any)?.archivo;
    if (a?.clave && !a.borradoAt) {
        await (await getS3Client()).send(new DeleteObjectCommand({ Bucket: BUCKET, Key: a.clave })).catch((e) => avisos.push(`modelo en el almacenamiento: ${e?.message || e}`));
    }
    for (const dir of [...new Set([(t as any).carpeta, path.join(CARPETAS, id), process.env.ENTRENADOR_TRABAJO ? path.join(process.env.ENTRENADOR_TRABAJO, id) : null].filter(Boolean) as string[])]) {
        // Sólo carpetas con el id del entrenamiento como último tramo: nunca algo más arriba.
        if (path.basename(dir) !== id) continue;
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e: any) { avisos.push(`carpeta ${dir}: ${e?.message || e}`); }
    }
    await prisma.entrenamientoDetector.delete({ where: { id } });
    return { ok: true, avisos };
}
