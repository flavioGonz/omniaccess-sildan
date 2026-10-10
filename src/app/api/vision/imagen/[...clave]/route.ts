import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { getS3Client } from "@/lib/s3";

export const dynamic = "force-dynamic";

/** El bucket del registro de detecciones (vision-worker). */
const BUCKET = process.env.VISION_BUCKET || "objetos";
/** Anchos que se aceptan para achicar: los de la grilla y la ficha. */
const ANCHOS = new Set([160, 320, 640, 960]);

/**
 * GET /api/vision/imagen/<clave>[?w=320] — un recorte o un cuadro del registro de detecciones, o
 * un recorte de la relectura de NO_LEIDA (vehículo y chapa).
 *
 * Por acá y no por /api/files: /api/files no pide sesión (sirve las capturas de LPR a la
 * consola y a WhatsApp), y estas fotos son de personas caminando por el barrio. Con sesión, y
 * sólo de este bucket: la clave no puede salir de él.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ clave: string[] }> }) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("El registro de detecciones no es una vista de pantalla.");
    const { clave } = await params;
    const key = (clave || []).join("/");
    // Las del registro (día/id-r|f.jpg), las de la relectura de NO_LEIDA (relectura/día/evento-v|c.jpg)
    // las de los eventos de las reglas (eventos/día/id.jpg) y las muestras de las analíticas
    // entrenables (zonas/zona/día/id.jpg).
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}\/[a-z0-9]+-[rf]\.jpg$/.test(key) && !/^relectura\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/[a-z0-9-]+-[vc]\.jpg$/.test(key)
        && !/^eventos\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/[a-z0-9]+\.jpg$/.test(key)
        && !/^zonas\/[a-z0-9]+\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/[a-z0-9]+\.jpg$/.test(key))
        return new NextResponse("Clave inválida", { status: 400 });
    try {
        const r = await (await getS3Client()).send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
        let buf: Buffer = Buffer.from(await r.Body!.transformToByteArray());
        const w = Number(req.nextUrl.searchParams.get("w"));
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
