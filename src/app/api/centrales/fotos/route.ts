/**
 * /api/centrales/fotos — dónde quedan las fotos de las alarmas de central y cuánto se guardan
 * (23/10, Nico: «crear su bucket para separar las fotos capturadas de confirmaciones de robo, y
 * cuidar muy bien las retenciones para que no se nos llene el disco»).
 *
 *   GET → { bucket, dias, topeGb, regla (días de la regla vigente en el bucket, 0 = ninguna), n, bytes, desde, truncado }
 *   PUT { dias?, topeGb? } → guarda, y aplica la regla de días en el bucket en el acto (el tope por
 *       tamaño lo aplica alarm-receiver cada 6 h). Pide «Configurar centrales» (hub.config); queda en Auditoría.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { CreateBucketCommand, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { sesionCon, auditar } from "@/lib/centrales/sesion";
import { permisosDeSesion } from "@/lib/permisos";
import { exigirFuncion } from "@/lib/funcion-servidor";
import { getS3InternalClient, getBucketLifecycle, updateBucketLifecycle } from "@/app/actions/settings";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ret = require("../../../../../lib-retencion-alarmas.js") as {
    AJUSTE_DIAS: string; AJUSTE_TOPE_GB: string; DIAS_MIN: number; DIAS_MAX: number; TOPE_GB_MIN: number; TOPE_GB_MAX: number;
    diasValidos: (v: unknown) => number; topeValido: (v: unknown) => number;
    leerRetencion: (p: typeof prisma) => Promise<{ dias: number; topeGb: number }>;
};
/** El mismo nombre que usa lib-s3.js al subir. */
const BUCKET_DEFECTO = "alarmas";
/** Para medir alcanzan 50 páginas (50.000 fotos): más que eso ya es una señal en sí. */
const PAGINAS_MAX = 50;

async function bucket() {
    const f = await prisma.setting.findUnique({ where: { key: "S3_BUCKET_ALARMAS" } }).catch(() => null);
    return f?.value || process.env.S3_BUCKET_ALARMAS || BUCKET_DEFECTO;
}

async function medir(nombre: string) {
    const s3 = await getS3InternalClient();
    let n = 0, bytes = 0, desde: Date | null = null, tok: string | undefined, paginas = 0, truncado = false;
    try {
        do {
            const r = await s3.send(new ListObjectsV2Command({ Bucket: nombre, ContinuationToken: tok }));
            for (const o of r.Contents || []) { n++; bytes += o.Size || 0; if (o.LastModified && (!desde || o.LastModified < desde)) desde = o.LastModified; }
            tok = r.IsTruncated ? r.NextContinuationToken : undefined;
            if (++paginas >= PAGINAS_MAX && tok) { truncado = true; break; }
        } while (tok);
    } catch (e: any) {
        if (e?.name === "NoSuchBucket") return { existe: false, n: 0, bytes: 0, desde: null, truncado: false };
        throw e;
    }
    return { existe: true, n, bytes, desde: desde ? desde.toISOString() : null, truncado };
}

export async function GET() {
    const funcionApagada = await exigirFuncion("FUNC_ALARMAS_RECEPCION"); if (funcionApagada) return funcionApagada;
    const { no } = await sesionCon(); if (no) return no;
    try {
        const nombre = await bucket();
        const [r, m, lc] = await Promise.all([ret.leerRetencion(prisma), medir(nombre), getBucketLifecycle(nombre)]);
        return NextResponse.json({
            ok: true, bucket: nombre, ...r, regla: (lc as any)?.success ? (lc as any).days || 0 : 0, ...m,
            limites: { diasMin: ret.DIAS_MIN, diasMax: ret.DIAS_MAX, topeMin: ret.TOPE_GB_MIN, topeMax: ret.TOPE_GB_MAX },
        }, { headers: { "Cache-Control": "no-store" } });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "No se pudo leer el almacenamiento" }, { status: 500 });
    }
}

export async function PUT(req: NextRequest) {
    const funcionApagada = await exigirFuncion("FUNC_ALARMAS_RECEPCION"); if (funcionApagada) return funcionApagada;
    const { s, no } = await sesionCon(); if (no) return no;
    if (!permisosDeSesion(s).includes("hub.config")) return NextResponse.json({ ok: false, error: "Hace falta el permiso Configurar centrales." }, { status: 403 });
    const b = await req.json().catch(() => ({}));
    const antes = await ret.leerRetencion(prisma);
    const dias = b?.dias != null ? ret.diasValidos(b.dias) : antes.dias;
    const topeGb = b?.topeGb != null ? ret.topeValido(b.topeGb) : antes.topeGb;
    await prisma.$transaction([
        prisma.setting.upsert({ where: { key: ret.AJUSTE_DIAS }, update: { value: String(dias) }, create: { key: ret.AJUSTE_DIAS, value: String(dias) } }),
        prisma.setting.upsert({ where: { key: ret.AJUSTE_TOPE_GB }, update: { value: String(topeGb) }, create: { key: ret.AJUSTE_TOPE_GB, value: String(topeGb) } }),
    ]);
    // La regla de días va al bucket ya (si no existe, se crea): no se espera a la vuelta del receptor.
    const nombre = await bucket();
    let aviso: string | null = null;
    try {
        const s3 = await getS3InternalClient();
        try { await s3.send(new HeadBucketCommand({ Bucket: nombre })); } catch { await s3.send(new CreateBucketCommand({ Bucket: nombre })); }
        const r = await updateBucketLifecycle(nombre, dias);
        if (!r.success) aviso = `Quedó guardado, pero el bucket no tomó la regla: ${(r as any).message}. Se reintenta en la próxima revisión.`;
    } catch (e: any) { aviso = `Quedó guardado, pero no se pudo hablar con el almacenamiento (${e?.message}). Se reintenta en la próxima revisión.`; }
    await auditar(s, "CENTRALES_FOTOS", nombre, true, `días ${antes.dias} → ${dias} · tope ${antes.topeGb} → ${topeGb} GB`).catch(() => { });
    return NextResponse.json({ ok: true, dias, topeGb, aviso });
}
