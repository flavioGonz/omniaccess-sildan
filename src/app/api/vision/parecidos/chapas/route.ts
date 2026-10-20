import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { getS3Client } from "@/lib/s3";
import { detectar } from "@/lib/vision";
import { normalizarChapa } from "@/lib/formato-chapa";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/vision/parecidos/chapas { ids: [ObjetoVisto.id] }
 *   → { chapas: { [id]: { texto, confianza, recorte, fuente } | null } }
 *
 * La matrícula de cada resultado de «Buscar parecidos» (18/10, Nico: «cuando hacés búsqueda de
 * parecidos, ¿podés también leer de la foto la matrícula e intentar relacionarlas?»). Dos auto
 * blancos se parecen; con la chapa se sabe si es EL MISMO auto o sólo uno parecido.
 *
 *  1. Si el registro ya la leyó (vision-worker lee rótulos y chapas sobre el cuadro principal y
 *     las guarda en `textos`), se usa esa: no cuesta nada.
 *  2. Si no, y es un vehículo, se lee A PEDIDO sobre la foto guardada: el recorte del vehículo
 *     con margen, agrandado si es chico (la foto es del substream y la chapa queda en pocos
 *     píxeles), al OCR de omni-vision. Lo que se lee se agrega a `textos` con `aPedido: true` —así
 *     el historial también la muestra— y si no se lee nada se guarda un «no» al lado de la foto
 *     en MinIO (<día>/<id>-p.json) para no volver a intentarlo en cada búsqueda.
 *
 * De a una foto: omni-vision atiende una inferencia a la vez y la GPU es también de omni-lpr.
 */
const BUCKET = process.env.VISION_BUCKET || "objetos";
const MAX_IDS = 24;
/** Margen alrededor del vehículo: la chapa suele estar en el borde de la caja. */
const MARGEN = 0.08;
/** Debajo de este ancho el recorte se agranda antes del OCR. */
const ANCHO_OCR = 640;
/** Confianza mínima de una lectura para darla como chapa. */
const CONF_MIN = 0.5;

type Chapa = { texto: string; confianza: number; recorte: string | null; fuente: "registro" | "foto" };

const claveNo = (foto: string) => foto.replace(/-f\.jpg$/, "-p.json");

async function leer(s3: any, key: string): Promise<Uint8Array | null> {
    try { const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key })); return await r.Body!.transformToByteArray(); }
    catch { return null; }
}

/** La mejor matrícula de `textos` (lo que guardó el registro o una lectura anterior). */
function mejorDeTextos(textos: unknown): Chapa | null {
    if (!Array.isArray(textos)) return null;
    let mejor: Chapa | null = null;
    for (const t of textos as any[]) {
        if (t?.tipo !== "matricula" || !t.texto) continue;
        const texto = String(t.texto).toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (texto.length < 5) continue;
        const c = Number(t.confianza) || 0;
        if (!mejor || c > mejor.confianza) mejor = { texto, confianza: c, recorte: typeof t.recorte === "string" ? t.recorte : null, fuente: t.aPedido ? "foto" : "registro" };
    }
    return mejor;
}

export async function POST(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("No es una vista de pantalla.");
    const b = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(b?.ids) ? b.ids.filter((x: unknown) => typeof x === "string").slice(0, MAX_IDS) : [];
    if (!ids.length) return NextResponse.json({ chapas: {} });

    const objetos = await prisma.objetoVisto.findMany({ where: { id: { in: ids } }, select: { id: true, grupo: true, foto: true, caja: true, textos: true } });
    const chapas: Record<string, Chapa | null> = {};
    let s3: any = null;
    let visionCaida = false;
    for (const o of objetos) {
        const ya = mejorDeTextos(o.textos);
        if (ya) { chapas[o.id] = ya; continue; }
        const caja = Array.isArray(o.caja) && (o.caja as any[]).length === 4 ? (o.caja as any[]).map(Number) : null;
        if (o.grupo !== "vehiculo" || !o.foto || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}\/[a-z0-9]+-f\.jpg$/.test(o.foto) || !caja) { chapas[o.id] = null; continue; }
        s3 ??= await getS3Client();
        if (await leer(s3, claveNo(o.foto))) { chapas[o.id] = null; continue; } // ya se intentó y no había
        if (visionCaida) continue; // queda sin respuesta: se intenta la próxima vez
        const jpeg = await leer(s3, o.foto);
        if (!jpeg) { chapas[o.id] = null; continue; }
        try {
            const img = sharp(Buffer.from(jpeg));
            const { width: W = 0, height: H = 0 } = await img.metadata();
            const mx = (caja[2] - caja[0]) * MARGEN, my = (caja[3] - caja[1]) * MARGEN;
            const left = Math.max(0, Math.floor((caja[0] - mx) * W)), top = Math.max(0, Math.floor((caja[1] - my) * H));
            const width = Math.min(W - left, Math.ceil((caja[2] - caja[0] + 2 * mx) * W)), height = Math.min(H - top, Math.ceil((caja[3] - caja[1] + 2 * my) * H));
            if (width < 24 || height < 16) { chapas[o.id] = null; continue; }
            let recorte = sharp(Buffer.from(jpeg)).extract({ left, top, width, height });
            if (width < ANCHO_OCR) recorte = recorte.resize({ width: ANCHO_OCR, kernel: "lanczos3" });
            const buf = await recorte.jpeg({ quality: 92 }).toBuffer();
            const r = await detectar(buf, { texto: true, umbral: 0.9 });
            let mejor: { texto: string; confianza: number } | null = null;
            for (const t of (r as any).textos || []) {
                if (t?.tipo !== "matricula" || t.sobreimpreso) continue;
                const c = Number(t.confianza) || 0;
                // Con forma de chapa (Mercosur, moto, vieja uruguaya): un cartel o un número de casa no.
                const n = c >= CONF_MIN ? normalizarChapa(t.texto) : null;
                if (!n) continue;
                if (!mejor || c > mejor.confianza) mejor = { texto: n.plate, confianza: c };
            }
            if (!mejor) {
                chapas[o.id] = null;
                await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: claveNo(o.foto), Body: JSON.stringify({ chapa: null, en: new Date().toISOString() }), ContentType: "application/json" })).catch(() => { });
                continue;
            }
            const conf = Math.round(mejor.confianza * 1000) / 1000;
            chapas[o.id] = { texto: mejor.texto, confianza: conf, recorte: null, fuente: "foto" };
            const textos = Array.isArray(o.textos) ? (o.textos as any[]) : [];
            await prisma.objetoVisto.update({ where: { id: o.id }, data: { textos: [...textos, { texto: mejor.texto, confianza: conf, tipo: "matricula", aPedido: true }] } }).catch(() => { });
        } catch {
            visionCaida = true;
        }
    }
    return NextResponse.json({ chapas }, { headers: { "Cache-Control": "no-store" } });
}
