import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "@/lib/s3";

/**
 * Los BYTES de una imagen que la aplicación tiene guardada, del lado del servidor.
 *
 * Existe porque `getImagePath` resuelve la URL para el navegador, y acá hace falta otra cosa: el
 * JPEG en la mano para mandárselo a un equipo. Hasta ahora el único camino implementado era
 * «si empieza con http, bajala», y la cara de un residente NO empieza con http — se guarda como
 * `face/abc.jpg` en MinIO. Por eso sincronizar un rostro a un terminal no mandaba nada y no se
 * quejaba: el `if` simplemente no entraba.
 */
export async function bytesDeImagen(ruta: string | null | undefined): Promise<Buffer | null> {
    if (!ruta) return null;
    try {
        if (ruta.startsWith("http")) {
            const r = await fetch(ruta, { signal: AbortSignal.timeout(8000) });
            if (!r.ok) return null;
            return Buffer.from(await r.arrayBuffer());
        }
        /* `bucket/clave/con/barras.jpg`, con o sin el prefijo de la ruta de archivos. */
        const limpio = ruta.replace(/^\/+/, "").replace(/^api\/files\//, "");
        const corte = limpio.indexOf("/");
        if (corte <= 0) return null;
        const bucket = limpio.slice(0, corte), clave = limpio.slice(corte + 1);
        const s3 = await getS3Client();
        const o = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: clave }));
        const b = await o.Body?.transformToByteArray();
        return b ? Buffer.from(b) : null;
    } catch { return null; }
}
