import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { getS3Client } from "@/lib/s3";
import { puedeCambiar } from "@/lib/zona-entrenable-servidor";
import { BUCKET, guardarFoto } from "@/lib/detector-propio-servidor";
import { GRUPO_PROPIO } from "@/lib/detector-propio";

export const dynamic = "force-dynamic";

/**
 * POST { entrenar?: "negativa" | "dibujar", deshacer?: true } — «esta detección está mal».
 *
 * 12/11, Nico, mirando Detecciones: «permití indicar cuando es falso y que sume para el
 * entrenamiento». La detección queda marcada (sale del registro y de la búsqueda; la fila sigue
 * hasta que la venza la retención, así se puede deshacer y contar cuántas falsas da cada clase).
 *
 * Que SUME al entrenamiento depende de qué detector se equivocó:
 *  · El entrenado acá (grupo «propio»): el cuadro de la detección entra al conjunto. Es el ejemplo
 *    que más enseña — justo la imagen donde se confundió. Lo que le enseña es el cuadro SIN
 *    recuadro en ese lugar, así que hay dos caminos:
 *      «negativa»: en esa foto no hay ninguno de los objetos que se entrenan → entra ya revisada,
 *                  como «No hay ninguno». Un clic y aprende.
 *      «dibujar»:  hay otros que sí son → entra a «Sin dibujar» para marcarlos. Darla por negativa
 *                  le enseñaría que los verdaderos tampoco son.
 *  · El de fábrica (personas, vehículos, animales): no se entrena acá, y decir que sí sería
 *    mentir. La marca sirve para limpiar el registro y la búsqueda, nada más.
 *
 * `deshacer` saca la marca. La foto que se haya sumado al conjunto queda: se descarta desde Entrenar.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { error, quien } = await puedeCambiar(); if (error) return error;
    const { id } = await params;
    const b = await req.json().catch(() => ({}));
    const o = await prisma.objetoVisto.findUnique({ where: { id }, select: { id: true, grupo: true, foto: true, deviceId: true, falsa: true } });
    if (!o) return NextResponse.json({ error: "Esa detección ya no está (la venció la retención)." }, { status: 404 });

    if (b?.deshacer) {
        await prisma.objetoVisto.update({ where: { id }, data: { falsa: false, falsaPor: null, falsaAt: null } });
        return NextResponse.json({ ok: true, falsa: false });
    }
    // Dos veces la misma no suma dos fotos al conjunto.
    if (o.falsa) return NextResponse.json({ ok: true, falsa: true, entrenamiento: null, yaEstaba: true });

    const entrenar = b?.entrenar === "negativa" || b?.entrenar === "dibujar" ? (b.entrenar as "negativa" | "dibujar") : null;
    let entrenamiento: null | { como: "negativa" | "dibujar"; fotoId: string } = null;
    let motivo: string | null = null;
    if (entrenar) {
        if (o.grupo !== GRUPO_PROPIO) motivo = "El detector de fábrica no se entrena acá.";
        else if (!o.foto) motivo = "Esa detección no guardó el cuadro entero.";
        else {
            try {
                const r = await (await getS3Client()).send(new GetObjectCommand({ Bucket: BUCKET, Key: o.foto }));
                const foto = await guardarFoto(Buffer.from(await r.Body!.transformToByteArray()), "REGISTRO", o.deviceId);
                if (entrenar === "negativa") await prisma.fotoEntrenamiento.update({ where: { id: foto.id }, data: { revisada: true, revisadaPor: quien, cajas: [] } });
                entrenamiento = { como: entrenar, fotoId: foto.id };
            } catch (e: any) {
                // La marca vale igual; se dice que la foto no entró, para que nadie crea que ya aprendió.
                motivo = `No se pudo copiar el cuadro al conjunto: ${e?.message || "error"}`;
            }
        }
    }
    await prisma.objetoVisto.update({ where: { id }, data: { falsa: true, falsaPor: quien, falsaAt: new Date() } });
    return NextResponse.json({ ok: true, falsa: true, entrenamiento, motivo });
}
