import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { getS3Client } from "@/lib/s3";
import { autorizarMonitor } from "@/lib/monitor/servidor";

export const dynamic = "force-dynamic";

const BUCKET = process.env.VISION_BUCKET || "objetos";

/**
 * GET /api/monitor/intrusion/verificacion/<detección> — el cuadro propio que vision-worker sacó
 * del canal para la doble verificación (en MinIO, bucket de visión), para la ficha del monitor de
 * intrusión. Con la autorización del monitor (las pantallas de pared entran con su enlace); la
 * clave sale de la base, nunca del pedido.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const p = await autorizarMonitor("/api/monitor/intrusion");
    if (p.error) return p.error;
    const { id } = await params;
    const d = await prisma.detection.findUnique({ where: { id }, select: { verifAnalisis: true } }).catch(() => null);
    const clave = (d?.verifAnalisis as any)?.propio?.foto as string | undefined;
    if (!clave) return new NextResponse("Sin cuadro propio", { status: 404 });
    try {
        const o = await (await getS3Client()).send(new GetObjectCommand({ Bucket: BUCKET, Key: clave }));
        let buf: Buffer = Buffer.from(await o.Body!.transformToByteArray());
        // ?w= para las miniaturas (OmniVision › Verificación): una grilla de cuadros de 1280 px
        // bajaba megas por pantalla para mostrarlos a 300.
        const w = Math.round(Number(req.nextUrl.searchParams.get("w")) || 0);
        if (w >= 80 && w < 1280) buf = await sharp(buf).resize({ width: w, withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer().catch(() => buf);
        return new Response(new Uint8Array(buf), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
    } catch (e: any) {
        return new NextResponse(e?.name === "NoSuchKey" ? "No existe (pudo vencer la retención)" : "No se pudo leer", { status: e?.name === "NoSuchKey" ? 404 : 502 });
    }
}
