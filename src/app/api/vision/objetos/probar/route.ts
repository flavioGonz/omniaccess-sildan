import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { puedeMirar } from "@/lib/zona-entrenable-servidor";
import { detectar } from "@/lib/vision";

export const dynamic = "force-dynamic";

/** Más grande no suma: el detector trabaja a su resolución, y la foto viaja de vuelta en base64. */
const LADO_MAX = 1280;
/** Una foto de celular entra holgada; más que esto es otra cosa. */
const BYTES_MAX = 15 * 1024 * 1024;

/**
 * POST /api/vision/objetos/probar  (cuerpo: la imagen, image/*)
 *
 * «Probar el modelo» con una foto subida (17/10, Nico: «que pueda ver la silueta o recuadro de
 * detección»): la foto pasa por omni-vision igual que un cuadro de cámara, así lo que se ve acá
 * es lo que el detector propio EN USO haría en producción, con su umbral medido al entrenar. Las
 * cámaras usan /api/vision/probar (el mismo cuadro del visor).
 *
 * La foto no se guarda: probar no es sumar al conjunto (para eso está «Agregar fotos»). Vuelve
 * en la respuesta, achicada, para que los recuadros se dibujen sobre la MISMA imagen que se miró.
 */
export async function POST(req: NextRequest) {
    const e = await puedeMirar(); if (e) return e;
    const tipo = req.headers.get("content-type") || "";
    if (!tipo.startsWith("image/")) return NextResponse.json({ error: "Mandá una imagen (JPG, PNG o WebP)." }, { status: 415 });
    const crudo = Buffer.from(await req.arrayBuffer());
    if (!crudo.length) return NextResponse.json({ error: "La imagen llegó vacía." }, { status: 400 });
    if (crudo.length > BYTES_MAX) return NextResponse.json({ error: "La imagen pesa más de 15 MB." }, { status: 413 });
    let foto: Buffer;
    try {
        foto = await sharp(crudo, { failOn: "error" }).rotate()
            .resize({ width: LADO_MAX, height: LADO_MAX, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    } catch { return NextResponse.json({ error: "No se pudo leer la imagen." }, { status: 400 }); }
    const u = Number(req.nextUrl.searchParams.get("umbral"));
    const umbral = Number.isFinite(u) && u > 0 ? Math.min(0.95, Math.max(0.05, u)) : undefined;
    try {
        const r = await detectar(foto, { umbral });
        return NextResponse.json({ ...r, imagen: `data:image/jpeg;base64,${foto.toString("base64")}`, instante: new Date().toISOString() },
            { headers: { "Cache-Control": "no-store" } });
    } catch (x: any) {
        return NextResponse.json({ error: x?.name === "TimeoutError" ? "omni-vision no contestó a tiempo" : x?.message || "omni-vision falló" }, { status: 502 });
    }
}
