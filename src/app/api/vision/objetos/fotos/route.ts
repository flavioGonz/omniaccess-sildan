import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { getS3Client } from "@/lib/s3";
import { puedeMirar, puedeCambiar } from "@/lib/zona-entrenable-servidor";
import { BUCKET, cuadroDeCamara, filaFoto, guardarFoto, nombresDeCamaras } from "@/lib/detector-propio-servidor";
import { imagenDeLink, LinkInvalido } from "@/lib/ingesta-link";

export const dynamic = "force-dynamic";

/** Una foto de celular pasa de 4 MB; más que esto no es una foto. */
const SUBIDA_MAX_BYTES = 15 * 1024 * 1024;
const LIMITE_DEFECTO = 120;
const LIMITE_MAX = 400;

/**
 * GET ?vista=sin|revisadas|negativas|todas&clase=<id>&limite=N — las fotos del conjunto.
 * POST — agregar una foto:
 *   ?camara=<id>       el cuadro de este momento, del stream PRINCIPAL (go2rtc «_hd»): para
 *                      entrenar se quiere la resolución entera, no el substream del registro.
 *   ?objeto=<id>       el cuadro de una detección del registro (lo que vio vision-worker).
 *   cuerpo image/*     una foto subida (de otra cámara, del celular, de internet).
 *   cuerpo JSON {url}  un link a una imagen (o a una página que la tenga): la trae el servidor,
 *                      sin bajarla y volver a subirla. Ver lib/ingesta-link.ts (qué no se deja).
 */
export async function GET(req: NextRequest) {
    const e = await puedeMirar(); if (e) return e;
    const sp = req.nextUrl.searchParams;
    const vista = sp.get("vista") || "sin";
    const clase = sp.get("clase");
    const limite = Math.min(LIMITE_MAX, Math.max(1, Number(sp.get("limite")) || LIMITE_DEFECTO));
    const where: any = vista === "sin" ? { revisada: false } : vista === "revisadas" ? { revisada: true } : vista === "negativas" ? { revisada: true, cajas: { equals: [] } } : {};
    let filas = await prisma.fotoEntrenamiento.findMany({ where, orderBy: { createdAt: vista === "sin" ? "asc" : "desc" }, take: clase ? LIMITE_MAX * 5 : limite });
    if (clase) filas = filas.filter((f) => ((f.cajas as any[]) || []).some((c) => c.clase === clase)).slice(0, limite);
    const camaras = await nombresDeCamaras([...new Set(filas.map((f) => f.deviceId).filter(Boolean))] as string[]);
    return NextResponse.json({ fotos: await Promise.all(filas.map((f) => filaFoto(f, camaras))) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
    const { error } = await puedeCambiar(); if (error) return error;
    const sp = req.nextUrl.searchParams;
    try {
        const camara = sp.get("camara");
        if (camara) {
            const c = await cuadroDeCamara(camara);
            if ("error" in c) return NextResponse.json({ error: c.error }, { status: c.status });
            return NextResponse.json({ foto: await filaFoto(await guardarFoto(c.bytes, "CAMARA", c.deviceId)) });
        }
        const objeto = sp.get("objeto");
        if (objeto) {
            const o = await prisma.objetoVisto.findUnique({ where: { id: objeto }, select: { foto: true, deviceId: true } });
            if (!o?.foto) return NextResponse.json({ error: "Esa detección no tiene cuadro guardado" }, { status: 404 });
            const r = await (await getS3Client()).send(new GetObjectCommand({ Bucket: BUCKET, Key: o.foto }));
            const b = Buffer.from(await r.Body!.transformToByteArray());
            return NextResponse.json({ foto: await filaFoto(await guardarFoto(b, "REGISTRO", o.deviceId)) });
        }
        const tipo = req.headers.get("content-type") || "";
        if (tipo.includes("application/json")) {
            const { url } = await req.json().catch(() => ({}));
            try {
                const { bytes } = await imagenDeLink(url);
                return NextResponse.json({ foto: await filaFoto(await guardarFoto(bytes, "SUBIDA", null)) });
            } catch (e: any) {
                if (e instanceof LinkInvalido) return NextResponse.json({ error: e.message }, { status: 422 });
                throw e;
            }
        }
        if (!tipo.startsWith("image/")) return NextResponse.json({ error: "Mandá una foto, una cámara o una detección" }, { status: 400 });
        const b = Buffer.from(await req.arrayBuffer());
        if (!b.length) return NextResponse.json({ error: "No llegó la foto" }, { status: 400 });
        if (b.length > SUBIDA_MAX_BYTES) return NextResponse.json({ error: "La foto pesa demasiado" }, { status: 413 });
        return NextResponse.json({ foto: await filaFoto(await guardarFoto(b, "SUBIDA", null)) });
    } catch (e: any) {
        const ilegible = /unsupported image|Input buffer|corrupt/i.test(e?.message || "");
        return NextResponse.json({ error: ilegible ? "No se pudo leer la foto. Probá con un JPG o un PNG." : (e?.message || "No se pudo guardar") }, { status: ilegible ? 415 : 500 });
    }
}
