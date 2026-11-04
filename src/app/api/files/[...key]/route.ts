import { NextRequest, NextResponse } from "next/server";
import { getS3Client } from "@/lib/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs/promises";
import { rutaMiniatura, guardarMiniatura } from "@/lib/miniaturas";
import { prisma } from "@/lib/prisma";

const BUCKET_NAME = process.env.S3_BUCKET || "lpr-prod";
// Alias de buckets legacy: paths viejos guardaron /api/files/lpr/... cuando el
// bucket real es lpr-prod. Remapeamos para no romper la evidencia historica.
const BUCKET_ALIASES: Record<string, string> = {
    lpr: process.env.S3_BUCKET || "lpr-prod",
};

/**
 * El bucket salía del path sin restricción: quien pasara la puerta de medios podía leer CUALQUIER
 * bucket del MinIO nombrándolo (4/11). Ahora sólo se sirven los buckets propios de OmniAccess. La
 * lista se arma de env + los Setting (queue/alarmas/intrusion pueden tener nombre propio) y se
 * cachea un minuto, para no consultar la base en cada una de las 200 fotos del explorador.
 */
let bucketsOk: { set: Set<string>; hasta: number } | null = null;
async function bucketsPermitidos(): Promise<Set<string>> {
    if (bucketsOk && bucketsOk.hasta > Date.now()) return bucketsOk.set;
    const s = new Set<string>(["lpr", "lpr-prod", "face", "intrusion", "alarmas", "queue"]);
    for (const v of [process.env.S3_BUCKET, process.env.S3_BUCKET_FACE, process.env.S3_BUCKET_QUEUE, process.env.S3_BUCKET_INTRUSION, process.env.S3_BUCKET_ALARMAS]) if (v) s.add(v);
    try {
        const filas = await prisma.setting.findMany({ where: { key: { in: ["S3_BUCKET_LPR", "S3_BUCKET_FACE", "S3_BUCKET_QUEUE", "S3_BUCKET_INTRUSION", "S3_BUCKET_ALARMAS"] } }, select: { value: true } });
        for (const f of filas) if (f.value) s.add(f.value);
    } catch { /* sin base: queda el conjunto por defecto */ }
    bucketsOk = { set: s, hasta: Date.now() + 60_000 };
    return s;
}

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ key: string[] }> }
) {
    try {
        const params = await context.params;
        const s3Client = await getS3Client();
        let keyParts = params.key;

        // Resilience: Handle potential double prefixing (api/files/api/files/...)
        while (keyParts.length > 2 && keyParts[0] === 'api' && keyParts[1] === 'files') {
            keyParts = keyParts.slice(2);
        }

        if (!keyParts || keyParts.length < 2) {
            return new NextResponse("Invalid file path", { status: 400 });
        }

        const bucketPedido = keyParts[0] || BUCKET_NAME;
        if (!(await bucketsPermitidos()).has(bucketPedido)) {
            return new NextResponse("Not found", { status: 404 });
        }
        let bucketName = BUCKET_ALIASES[bucketPedido] || bucketPedido;
        const fileKey = keyParts.slice(1).join("/");

        // Miniatura ya hecha: se sirve del disco sin ir a MinIO ni a sharp. Es lo que hace que la
        // segunda visita al explorador (200 fotos de 1–2 MB) sea instantánea en vez de volver a
        // bajar y reducir todo. Las claves son inmutables (una captura no cambia), así que la
        // caché no vence; se limpia por tamaño en limpiarCacheMiniaturas().
        const wParamPrevio = req.nextUrl.searchParams.get("w");
        const wPrevio = wParamPrevio ? parseInt(wParamPrevio) : 0;
        const rutaCache = wPrevio > 0 && wPrevio <= 2000 ? rutaMiniatura(bucketName, fileKey, wPrevio) : null;
        if (rutaCache) {
            try {
                const cacheada = await fs.readFile(rutaCache);
                return new Response(cacheada as any, { status: 200, headers: { "Content-Type": "image/jpeg", "Content-Length": String(cacheada.length), "Cache-Control": "public, max-age=31536000, immutable", "X-Miniatura": "cache" } });
            } catch { /* no está: se genera abajo */ }
        }

        const command = new GetObjectCommand({ Bucket: bucketName, Key: fileKey });
        const response = await s3Client.send(command);

        if (!response.Body) {
            return new NextResponse("File not found", { status: 404 });
        }

        const byteArray = await new Promise<Buffer>((resolve, reject) => {
            const chunks: any[] = [];
            (response.Body as any).on('data', (chunk: any) => chunks.push(chunk));
            (response.Body as any).on('error', reject);
            (response.Body as any).on('end', () => resolve(Buffer.concat(chunks)));
        });

        // Optional on-the-fly thumbnail: /api/files/...jpg?w=256 -> resized JPEG (huge perf win
        // for list thumbnails; the original detectionPicture is 1-2MB which stalls the monitor).
        let outBuf: Buffer = byteArray;
        let outType = response.ContentType || "image/jpeg";
        const wParam = req.nextUrl.searchParams.get("w");
        if (wParam) {
            const w = parseInt(wParam);
            if (w > 0 && w <= 2000) {
                try {
                    const sharp = (await import("sharp")).default;
                    outBuf = await sharp(byteArray).rotate().resize({ width: w, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
                    outType = "image/jpeg";
                    if (rutaCache) guardarMiniatura(rutaCache, outBuf).catch(() => null);
                } catch (e) { outBuf = byteArray; }
            }
        }

        return new Response(outBuf as any, {
            status: 200,
            headers: {
                "Content-Type": outType,
                "Content-Length": outBuf.length.toString(),
                "Cache-Control": "public, max-age=31536000, immutable",
            },
        });
    } catch (error: any) {
        const msg = String(error?.name || "") + " " + String(error?.message || "");
        // Bucket u objeto inexistente -> 404 (no 500), asi el <img> muestra el placeholder limpio
        if (/NoSuchKey|NoSuchBucket|does not exist|NotFound/i.test(msg)) {
            return new Response("File not found", { status: 404 });
        }
        console.error("[S3 Proxy] Critical Failure fetching:", error);
        return new Response(`Error fetching file: ${error.message}`, { status: 500 });
    }
}
