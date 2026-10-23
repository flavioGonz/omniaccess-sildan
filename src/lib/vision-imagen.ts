import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "@/lib/s3";

/** El bucket del registro de detecciones (vision-worker). */
const BUCKET = process.env.VISION_BUCKET || "objetos";
/** Anchos que se aceptan para achicar: los de la grilla y la ficha. */
const ANCHOS = new Set([160, 320, 640, 960]);

/**
 * Un recorte o un cuadro del registro de detecciones (ver /api/vision/imagen). Lo comparten esa
 * ruta (panel) y /api/monitor/camaras/imagen (la pared con enlace de pantalla, openspec pared-vms):
 * quien llama ya decidió si puede. La clave no puede salir del bucket ni de sus formas conocidas.
 */
export async function imagenDeVision(clave: string[] | undefined, w: number): Promise<Response> {
    const key = (clave || []).join("/");
    // Las del registro (día/id-r|f|c.jpg: recorte, cuadro y chapa), las de la relectura de NO_LEIDA (relectura/día/evento-v|c.jpg)
    // las de los eventos de las reglas (eventos/día/id.jpg) y las muestras de las analíticas
    // entrenables (zonas/zona/día/id.jpg) y las fotos del detector propio (entrenamiento/día/id.jpg).
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}\/[a-z0-9]+-[rfc]\.jpg$/.test(key) && !/^relectura\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/[a-z0-9-]+-[vc]\.jpg$/.test(key)
        && !/^eventos\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/[a-z0-9]+\.jpg$/.test(key)
        && !/^zonas\/[a-z0-9]+\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/[a-z0-9]+\.jpg$/.test(key)
        && !/^entrenamiento\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/[a-z0-9]+\.jpg$/.test(key))
        return new NextResponse("Clave inválida", { status: 400 });
    try {
        const r = await (await getS3Client()).send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
        let buf: Buffer = Buffer.from(await r.Body!.transformToByteArray());
        if (ANCHOS.has(w)) {
            const sharp = (await import("sharp")).default;
            buf = await sharp(buf).resize({ width: w, withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
        }
        // El recorte y la foto se reescriben cuando la pista consigue una mejor: caché corta.
        return new Response(new Uint8Array(buf), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=30" } });
    } catch (e: any) {
        return new NextResponse(e?.name === "NoSuchKey" ? "No existe (pudo vencer la retención)" : "No se pudo leer", { status: e?.name === "NoSuchKey" ? 404 : 502 });
    }
}
