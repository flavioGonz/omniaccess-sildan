import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { getS3Client } from "@/lib/s3";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { VISION_URL } from "@/lib/vision";
import { PUNTOS_SILUETA_MAX } from "@/lib/vision-capa";

export const dynamic = "force-dynamic";

/**
 * GET /api/vision/objetos/<id>/silueta — la silueta del objeto de una pista, sobre su foto (pedido
 * de Nico, 15/10: «en Buscar, la silueta también, como en el historial de acceso»).
 *
 * El registro guarda de cada pista la foto del mejor cuadro y la CAJA del objeto, no su silueta:
 * el worker detecta (no segmenta) en cada cuadro, porque segmentar todo lo que pasa sería pagar
 * la máscara de miles de pistas que nadie va a mirar. Acá se segmenta la foto cuando alguien la
 * mira, una vez: el resultado queda en memoria.
 *
 * De lo que encuentra la segmentación se devuelve un solo objeto: el que más se superpone con la
 * caja guardada (del mismo grupo si lo hay). La foto puede tener otros autos o personas que no son
 * la pista.
 *
 * Costo: ~40 ms de omni-vision por foto. Se atienden de a una (omni-vision comparte la GPU con el
 * lector de chapas) y con una fila de a lo sumo FILA_MAX: lo que no entra contesta 429 y la
 * tarjeta queda sin silueta, que es como estaba.
 */
const BUCKET = process.env.VISION_BUCKET || "objetos";
const GUARDADAS_MAX = 3000;
const FILA_MAX = 80;
/** Debajo de esta superposición con la caja guardada no es el mismo objeto: mejor no dibujar nada. */
const IOU_MIN = 0.3;

type Respuesta = { ancho: number; alto: number; objetos: unknown[] };
const guardadas = new Map<string, Respuesta>();
let cola: Promise<unknown> = Promise.resolve();
let enFila = 0;

function iou(a: number[], b: number[]) {
    const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
    const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i;
    return u > 0 ? i / u : 0;
}
const r4 = (v: number) => Math.round(v * 10000) / 10000;
function aligerar(poli: number[][]): number[][] {
    if (poli.length <= PUNTOS_SILUETA_MAX) return poli;
    const paso = poli.length / PUNTOS_SILUETA_MAX;
    return Array.from({ length: PUNTOS_SILUETA_MAX }, (_, i) => poli[Math.floor(i * paso)]);
}

async function segmentar(id: string): Promise<Respuesta | null> {
    const o = await prisma.objetoVisto.findUnique({ where: { id }, select: { foto: true, caja: true, grupo: true } });
    if (!o?.foto || !Array.isArray(o.caja)) return null;
    const caja = o.caja as number[];
    const r = await (await getS3Client()).send(new GetObjectCommand({ Bucket: BUCKET, Key: o.foto }));
    const jpeg = Buffer.from(await r.Body!.transformToByteArray());
    const v = await fetch(`${VISION_URL()}/detectar?tarea=segmentar&umbral=0.3&grupos=persona,vehiculo,animal,propio`, {
        method: "POST", body: new Uint8Array(jpeg), headers: { "content-type": "image/jpeg" }, signal: AbortSignal.timeout(8000),
    });
    const j: any = await v.json().catch(() => ({}));
    if (!v.ok) throw new Error(j.error || `omni-vision respondió ${v.status}`);
    const candidatos = (j.objetos || []).filter((x: any) => Array.isArray(x.caja_norm))
        .map((x: any) => ({ x, s: iou(x.caja_norm, caja) + (x.grupo === o.grupo ? 0.15 : 0) }))
        .sort((a: any, b: any) => b.s - a.s);
    const mejor = candidatos[0] && iou(candidatos[0].x.caja_norm, caja) >= IOU_MIN ? candidatos[0].x : null;
    return {
        ancho: j.ancho, alto: j.alto,
        objetos: mejor ? [{
            clase: mejor.clase, nombre: mejor.nombre, grupo: mejor.grupo, confianza: Math.round(mejor.confianza * 1000) / 1000,
            caja: mejor.caja_norm.map(r4),
            ...(Array.isArray(mejor.silueta) ? { silueta: mejor.silueta.map((q: number[][]) => aligerar(q).map(([a, b]) => [r4(a), r4(b)])) } : {}),
        }] : [],
    };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("El registro de detecciones no es una vista de pantalla.");
    const { id } = await params;
    if (!/^[a-z0-9]{10,40}$/.test(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });
    const ya = guardadas.get(id);
    if (ya) return NextResponse.json(ya, { headers: { "Cache-Control": "private, max-age=3600" } });
    if (enFila >= FILA_MAX) return NextResponse.json({ error: "Demasiadas a la vez" }, { status: 429, headers: { "Retry-After": "2" } });
    enFila++;
    const turno = cola.then(() => segmentar(id));
    cola = turno.catch(() => null);
    try {
        const r = await turno;
        if (!r) return NextResponse.json({ error: "Esa pista no tiene foto" }, { status: 404 });
        guardadas.set(id, r);
        if (guardadas.size > GUARDADAS_MAX) guardadas.delete(guardadas.keys().next().value!);
        return NextResponse.json(r, { headers: { "Cache-Control": "private, max-age=3600" } });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "omni-vision no contestó" }, { status: 502 });
    } finally { enFila--; }
}
