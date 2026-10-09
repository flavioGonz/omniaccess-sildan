"use server";

import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { getS3Client } from "@/lib/s3";
import { leerGuardia } from "@/lib/sesion-guardia";
import { CLAVE_EMPRESAS, normalizarCatalogo, normalizarNombre, type Empresa } from "@/lib/empresas";
import { leerCatalogo, logosDeMatriculas, type LogoDeMatricula } from "@/lib/empresas-servidor";

/**
 * El catálogo de empresas (Ajustes → Empresas) y sus logos.
 *
 * Los logos van a su propio bucket, `marcas`, y no al de capturas: el de LPR se recicla
 * solo cuando se llena (borra lo más viejo), y un logo subido hace un año es justamente
 * lo más viejo que hay.
 */

const BUCKET_LOGOS = "marcas";
/** Un logo de verdad pesa decenas de KB; 2 MB ya es una foto, no un logo. */
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
/** Alto al que se guarda: sobre la captura se ve a 28-40 px, el doble alcanza para pantallas densas. */
const LOGO_ALTO = 160;

async function exigirAjustes() {
    const s: any = await getSession();
    if (!s || !permisosDeSesion(s).includes("ajustes")) throw new Error("Sólo quien tiene Ajustes puede cambiar el catálogo de empresas.");
    return s;
}

const leer = leerCatalogo;

async function escribir(lista: Empresa[]) {
    const limpio = normalizarCatalogo(lista);
    const value = JSON.stringify(limpio);
    await prisma.setting.upsert({ where: { key: CLAVE_EMPRESAS }, create: { key: CLAVE_EMPRESAS, value }, update: { value } });
    return limpio;
}

/**
 * El catálogo. Lo lee cualquiera con sesión del panel (monitor, ficha de persona) y el
 * guardia de la garita, que entra con su PIN y no tiene sesión del panel.
 */
export async function getEmpresas(): Promise<Empresa[]> {
    const s = await getSession();
    if (!s && !(await leerGuardia())) return [];
    return leer();
}

export async function guardarEmpresas(lista: Empresa[]): Promise<{ ok: true; empresas: Empresa[] } | { ok: false; error: string }> {
    try {
        await exigirAjustes();
        // Los logos no se pisan desde acá: viajan en la lista, pero el que vale es el guardado.
        const actual = await leer();
        const logos = new Map(actual.map((e) => [e.clave, { logo: e.logo, transparente: e.transparente }]));
        const nuevas = lista.map((e) => ({ ...e, ...(logos.get(normalizarNombre(e.clave || e.nombre)) || { logo: null, transparente: false }) }));
        return { ok: true, empresas: await escribir(nuevas) };
    } catch (e: any) { return { ok: false, error: e?.message || "No se pudo guardar" }; }
}

async function asegurarBucket(s3: Awaited<ReturnType<typeof getS3Client>>) {
    try { await s3.send(new HeadBucketCommand({ Bucket: BUCKET_LOGOS })); }
    catch { await s3.send(new CreateBucketCommand({ Bucket: BUCKET_LOGOS })); }
}

/**
 * Sube el logo de una empresa. Se recorta el borde vacío y se lleva a LOGO_ALTO, siempre en
 * PNG para no perder la transparencia. Se avisa si no la tiene: un JPG sobre una captura es
 * un rectángulo blanco tapando la foto.
 */
export async function subirLogoEmpresa(fd: FormData): Promise<{ ok: true; empresa: Empresa } | { ok: false; error: string }> {
    try {
        await exigirAjustes();
        const clave = normalizarNombre(String(fd.get("clave") || ""));
        const archivo = fd.get("archivo") as File | null;
        if (!clave || !archivo) return { ok: false, error: "Falta la empresa o el archivo." };
        if (archivo.size > LOGO_MAX_BYTES) return { ok: false, error: "El archivo pasa de 2 MB: para un logo alcanza con mucho menos." };
        const lista = await leer();
        const i = lista.findIndex((e) => e.clave === clave);
        if (i < 0) return { ok: false, error: "Esa empresa no está en el catálogo. Guardala primero." };

        const sharp = (await import("sharp")).default;
        const entrada = Buffer.from(await archivo.arrayBuffer());
        let img = sharp(entrada, { failOn: "error" }).ensureAlpha();
        // trim() saca el margen del color del borde; si la imagen es toda de un color, falla y se deja como está.
        try { img = sharp(await img.trim().toBuffer()); } catch { img = sharp(entrada).ensureAlpha(); }
        const png = await img.resize({ height: LOGO_ALTO, withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
        const { isOpaque } = await sharp(png).stats();

        const s3 = await getS3Client();
        await asegurarBucket(s3);
        // Nombre nuevo en cada subida: /api/files sirve con caché inmutable, y el mismo nombre
        // dejaría el logo viejo en todos los navegadores que ya lo vieron.
        const key = `${clave}-${Date.now()}.png`;
        await s3.send(new PutObjectCommand({ Bucket: BUCKET_LOGOS, Key: key, Body: png, ContentType: "image/png" }));

        lista[i] = { ...lista[i], logo: `/api/files/${BUCKET_LOGOS}/${key}`, transparente: !isOpaque };
        const guardada = await escribir(lista);
        return { ok: true, empresa: guardada.find((e) => e.clave === clave)! };
    } catch (e: any) {
        return { ok: false, error: /unsupported image|Input buffer/i.test(e?.message || "") ? "No se pudo leer la imagen. Probá con un PNG o un SVG." : (e?.message || "No se pudo subir el logo") };
    }
}

export async function quitarLogoEmpresa(clave: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
        await exigirAjustes();
        const lista = await leer();
        await escribir(lista.map((e) => e.clave === clave ? { ...e, logo: null, transparente: false } : e));
        return { ok: true };
    } catch (e: any) { return { ok: false, error: e?.message || "No se pudo quitar" }; }
}

/** Matrícula → logo de su empresa, para el monitor LPR. Ver lib/empresas-servidor. */
export async function logosPorMatricula(): Promise<Record<string, LogoDeMatricula>> {
    const s = await getSession();
    if (!s) return {};
    return logosDeMatriculas();
}
