import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { getS3Client } from "@/lib/s3";
import { detectar } from "@/lib/vision";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/history/ov-siluetas { ids: [ObjetoVisto.id] } → { siluetas: { [id]: Pt[][] | null } }
 *
 * La silueta de verdad de las filas de OmniVision del historial (18/10, Nico: «se ve el recuadro,
 * no la silueta»). El registro de las cámaras RTSP guarda sólo la caja de cada objeto: el contorno
 * lo da la segmentación, que corre sobre las fotos de LPR pero no sobre las del registro (son miles
 * por día y casi nadie las mira). Así que se segmenta A PEDIDO, sólo lo que alguien está mirando:
 * la tabla pide las filas que tiene en pantalla, la silueta aparece unos segundos después, y queda
 * guardada al lado de la foto en MinIO (<día>/<id>-s.json) para la próxima vez.
 *
 * De la segmentación se toma el objeto que más se superpone con la caja del registro (la foto puede
 * tener otros autos o personas); si ninguno coincide, se guarda null y la fila queda con el recuadro.
 * De a una foto: omni-vision atiende una inferencia a la vez y la GPU es también de omni-lpr.
 */
const BUCKET = process.env.VISION_BUCKET || "objetos";
const MAX_IDS = 24;
/** Superposición mínima (IoU) entre la caja del registro y la del objeto segmentado. */
const IOU_MIN = 0.3;
const PUNTOS_MAX = 80;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
type Pt = [number, number];

function iou(a: number[], b: number[]) {
    const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
    return u > 0 ? inter / u : 0;
}
function aligerar(p: Pt[]): Pt[] {
    if (p.length <= PUNTOS_MAX) return p;
    const paso = p.length / PUNTOS_MAX;
    return Array.from({ length: PUNTOS_MAX }, (_, i) => p[Math.floor(i * paso)]);
}
const claveSilueta = (foto: string) => foto.replace(/-f\.jpg$/, "-s.json");

async function leer(s3: any, key: string): Promise<Uint8Array | null> {
    try { const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key })); return await r.Body!.transformToByteArray(); }
    catch { return null; }
}

export async function POST(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("No es una vista de pantalla.");
    const b = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(b?.ids) ? b.ids.filter((x: unknown) => typeof x === "string").slice(0, MAX_IDS) : [];
    if (!ids.length) return NextResponse.json({ siluetas: {} });

    const objetos = await prisma.objetoVisto.findMany({ where: { id: { in: ids } }, select: { id: true, foto: true, caja: true } });
    const s3 = await getS3Client();
    const siluetas: Record<string, Pt[][] | null> = {};
    let visionCaida = false;
    for (const o of objetos) {
        const caja = Array.isArray(o.caja) && (o.caja as any[]).length === 4 ? (o.caja as any[]).map(Number) : null;
        if (!o.foto || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}\/[a-z0-9]+-f\.jpg$/.test(o.foto) || !caja) { siluetas[o.id] = null; continue; }
        // Ya calculada.
        const guardada = await leer(s3, claveSilueta(o.foto));
        if (guardada) {
            try { siluetas[o.id] = JSON.parse(Buffer.from(guardada).toString("utf8")).silueta ?? null; continue; } catch { /* se recalcula */ }
        }
        if (visionCaida) continue; // sin respuesta: queda para la próxima, no se guarda null
        const jpeg = await leer(s3, o.foto);
        if (!jpeg) { siluetas[o.id] = null; continue; }
        try {
            const r = await detectar(Buffer.from(jpeg), { tarea: "segmentar" });
            let mejor: { s: number; sil: Pt[][] } | null = null;
            for (const x of r.objetos || []) {
                if (!x.silueta?.length || !x.caja_norm) continue;
                const s = iou(caja, x.caja_norm);
                if (s >= IOU_MIN && (!mejor || s > mejor.s)) mejor = { s, sil: x.silueta };
            }
            const sil = mejor ? mejor.sil.map((p) => aligerar(p as Pt[]).map(([x, y]) => [r4(x), r4(y)] as Pt)) : null;
            siluetas[o.id] = sil;
            await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: claveSilueta(o.foto), Body: JSON.stringify({ silueta: sil, iou: mejor ? r4(mejor.s) : null }), ContentType: "application/json" })).catch(() => { });
        } catch {
            visionCaida = true;
        }
    }
    return NextResponse.json({ siluetas }, { headers: { "Cache-Control": "no-store" } });
}
