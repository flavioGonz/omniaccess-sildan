import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client, getS3Config } from "@/lib/s3";

export const dynamic = "force-dynamic";

/**
 * Sirve los cuadros guardados por la pasarela de seguimiento.
 *
 * Desde el 25/11 los cuadros van al almacén (bucket de LPR, `track/<archivo>`) y no al disco del
 * servidor, donde se juntaban sin límite. Los avistamientos viejos siguen apuntando acá: primero se
 * busca en el disco (lo que todavía no se pasó, o lo que quedó ahí porque el almacén no contestó) y
 * si no está, en el almacén.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
    const { file } = await params;
    const safe = path.basename(file || "");
    if (!/^[A-Za-z0-9._-]+\.jpg$/.test(safe)) return new Response("bad name", { status: 400 });
    const dir = process.env.TRACKING_SHOTS_DIR || "/datos/track";
    const cabeceras = { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" };
    try {
        return new Response(new Uint8Array(fs.readFileSync(path.join(dir, safe))), { status: 200, headers: cabeceras });
    } catch { /* no está en el disco: se busca en el almacén */ }
    try {
        const [s3, cfg] = await Promise.all([getS3Client(), getS3Config()]);
        const o = await s3.send(new GetObjectCommand({ Bucket: cfg.bucketLpr, Key: `track/${safe}` }));
        const bytes = await (o.Body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
        return new Response(new Uint8Array(bytes), { status: 200, headers: cabeceras });
    } catch {
        return new Response("not found", { status: 404 });
    }
}
