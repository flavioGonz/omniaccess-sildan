import { NextRequest, NextResponse } from "next/server";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getS3Client } from "@/lib/s3";
import { validarZona } from "@/lib/zona-entrenable";
import { puedeMirar, puedeCambiar, conteos, salida } from "@/lib/zona-entrenable-servidor";

export const dynamic = "force-dynamic";
const BUCKET = process.env.VISION_BUCKET || "objetos";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const no = await puedeMirar(); if (no) return no;
    const { id } = await params;
    const z = await prisma.zonaEntrenable.findUnique({ where: { id } });
    if (!z) return NextResponse.json({ error: "No existe." }, { status: 404 });
    const [c, cam] = await Promise.all([conteos([id]), prisma.device.findUnique({ where: { id: z.deviceId }, select: { name: true } })]);
    const eventos = await prisma.eventoVision.findMany({ where: { reglaId: id, tipo: "ZONA" }, orderBy: { ts: "desc" }, take: 20 });
    return NextResponse.json({
        zona: salida(z, c.get(id), cam?.name),
        eventos: eventos.map((e) => ({ id: e.id, ts: e.ts.toISOString(), prob: e.valor, foto: e.foto ? `/api/vision/imagen/${e.foto}` : null, avisado: !!e.avisoId })),
    }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * PUT — cambiar la configuración. Si cambia la cámara o la zona, el modelo entrenado se descarta:
 * aprendió a mirar OTRO recorte, y seguir usándolo daría probabilidades sin sentido con aire de
 * dato cierto. Las muestras quedan (sus etiquetas valen para lo que mostraban).
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { error } = await puedeCambiar(); if (error) return error;
    const { id } = await params;
    const antes = await prisma.zonaEntrenable.findUnique({ where: { id } });
    if (!antes) return NextResponse.json({ error: "No existe." }, { status: 404 });
    const { datos, errores } = validarZona(await req.json().catch(() => null));
    if (!datos) return NextResponse.json({ error: errores.join(" · ") }, { status: 400 });
    const otraMirada = antes.deviceId !== datos.deviceId || JSON.stringify(antes.zona) !== JSON.stringify(datos.zona);
    await prisma.zonaEntrenable.update({
        where: { id },
        data: {
            ...datos, zona: datos.zona as any, horario: (datos.horario as any) ?? Prisma.DbNull,
            ...(otraMirada ? { modelo: Prisma.DbNull, estado: Prisma.DbNull, forzarAt: new Date() } : {}),
        },
    });
    return NextResponse.json({ ok: true, modeloDescartado: otraMirada && !!antes.modelo });
}

/** DELETE — la zona, sus muestras y sus recortes. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { error } = await puedeCambiar(); if (error) return error;
    const { id } = await params;
    const claves = (await prisma.muestraZona.findMany({ where: { zonaId: id }, select: { recorte: true } })).map((m) => ({ Key: m.recorte }));
    await prisma.zonaEntrenable.delete({ where: { id } }).catch(() => null);
    // La zona ya no está aunque falle el bucket: los recortes huérfanos no se muestran en ningún
    // lado. Se dice igual, para que nadie crea que se liberó el espacio.
    let recortesBorrados = true;
    try {
        const s3 = await getS3Client();
        for (let i = 0; i < claves.length; i += 1000) await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: claves.slice(i, i + 1000), Quiet: true } }));
    } catch { recortesBorrados = false; }
    return NextResponse.json({ ok: true, recortes: claves.length, recortesBorrados });
}
