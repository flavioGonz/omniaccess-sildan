import { NextRequest, NextResponse } from "next/server";
import { getS3Client } from "@/lib/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";

const BUCKET_NAME = process.env.S3_BUCKET || "lpr-prod";
// Alias de buckets legacy: paths viejos guardaron /api/files/lpr/... cuando el
// bucket real es lpr-prod. Remapeamos para no romper la evidencia historica.
const BUCKET_ALIASES: Record<string, string> = {
    lpr: process.env.S3_BUCKET || "lpr-prod",
};

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

        let bucketName = keyParts[0] || BUCKET_NAME;
        bucketName = BUCKET_ALIASES[bucketName] || bucketName;
        const fileKey = keyParts.slice(1).join("/");

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
