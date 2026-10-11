import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { getS3Client } from "@/lib/s3";
import { autorizarMonitor } from "@/lib/monitor/servidor";

export const dynamic = "force-dynamic";

const BUCKET = process.env.VISION_BUCKET || "objetos";

/**
 * GET /api/monitor/lpr/relectura/<evento>?que=c|v — el recorte de la chapa (c) o del vehículo
 * (v) de la relectura de una NO_LEIDA, para Control LPR.
 *
 * Aparte de /api/vision/imagen porque ésa pide sesión del panel (el registro de detecciones
 * tiene fotos de gente caminando) y las pantallas de pared entran con su enlace. Esto sólo
 * sirve recortes de VEHÍCULOS de un evento LPR, lo mismo que la pantalla ya muestra en la
 * captura; la clave sale de la base, nunca del pedido.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const p = await autorizarMonitor("/api/monitor/lpr/relectura");
    if (p.error) return p.error;
    const { id } = await params;
    const que = req.nextUrl.searchParams.get("que") === "v" ? "v" : "c";
    const r = await prisma.relectura.findUnique({ where: { accessEventId: id }, select: { recorte: true, recorteChapa: true } }).catch(() => null);
    const clave = que === "v" ? r?.recorte : r?.recorteChapa;
    if (!clave) return new NextResponse("Sin recorte", { status: 404 });
    try {
        const o = await (await getS3Client()).send(new GetObjectCommand({ Bucket: BUCKET, Key: clave }));
        const buf = Buffer.from(await o.Body!.transformToByteArray());
        return new Response(new Uint8Array(buf), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
    } catch (e: any) {
        return new NextResponse(e?.name === "NoSuchKey" ? "No existe (pudo vencer la retención)" : "No se pudo leer", { status: e?.name === "NoSuchKey" ? 404 : 502 });
    }
}
