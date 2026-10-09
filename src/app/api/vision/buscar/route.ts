import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { VISION_URL, empresasEnTextos } from "@/lib/vision";
import { leerCatalogo } from "@/lib/empresas-servidor";
import { normalizarNombre } from "@/lib/empresas";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/vision/buscar?q=camioneta blanca con escalera  ·  ?parecido=<objetoId>
 *   &h=24|168|720  &camara=<deviceId>  &grupo=persona|vehiculo|animal|objeto
 *
 * Busca en el registro de detecciones por CÓMO SE VE: la frase (o el recorte de otra pista) se
 * convierte en un vector de SigLIP 2 y se compara por coseno con la huella del recorte de cada
 * pista (HuellaObjeto, ver vision-analisis.js). No hay índice vectorial en la base: las huellas
 * del rango se traen y se comparan acá (30 días de un barrio son decenas de miles, unos
 * milisegundos de cuentas).
 *
 * La frase se manda tal cual y como «una foto de …», y se promedian: SigLIP aprendió de textos
 * que describen fotos, y el promedio es más estable que cualquiera de las dos sola.
 */
const RANGOS_H = new Set([24, 168, 720]);
/** Cuántos resultados se devuelven: lo que se mira de una vez en la grilla. */
const RESULTADOS = 60;
/** Tope de huellas que se comparan: un rango de 30 días con todo el barrio no pasa de esto. */
const CANDIDATOS_MAX = 80_000;
const PLANTILLAS = (q: string) => [q, `una foto de ${q}`];
const TIEMPO_MS = 20_000;

async function vectorDeTexto(q: string): Promise<{ v: Float32Array; escala: number; sesgo: number }> {
    const r = await fetch(`${VISION_URL()}/vector_texto`, {
        method: "POST", body: JSON.stringify({ textos: PLANTILLAS(q) }), headers: { "content-type": "application/json" },
        cache: "no-store", signal: AbortSignal.timeout(TIEMPO_MS),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error || `omni-vision respondió ${r.status}`);
    const vs: number[][] = j.vectores;
    const v = new Float32Array(vs[0].length);
    for (const x of vs) for (let i = 0; i < v.length; i++) v[i] += x[i];
    return { v: normalizar(v), escala: j.escala, sesgo: j.sesgo };
}

function normalizar(v: Float32Array) {
    let n = 0; for (let i = 0; i < v.length; i++) n += v[i] * v[i];
    n = Math.sqrt(n) || 1; for (let i = 0; i < v.length; i++) v[i] /= n;
    return v;
}
const deInt8 = (b: Uint8Array | Buffer, escala: number) => { const q = new Int8Array(b.buffer, b.byteOffset, b.byteLength); return normalizar(Float32Array.from(q, (x) => x * escala)); };

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("La búsqueda no es una vista de pantalla.");
    const sp = req.nextUrl.searchParams;
    const q = String(sp.get("q") || "").trim().slice(0, 200);
    const parecido = sp.get("parecido");
    const hq = Number(sp.get("h"));
    const h = RANGOS_H.has(hq) ? hq : 168;
    const camara = sp.get("camara") || null;
    const grupo = sp.get("grupo") || null;
    if (!q && !parecido) return NextResponse.json({ error: "Escribí qué buscar" }, { status: 400 });
    const t0 = Date.now();

    let consulta: Float32Array, escala: number | null = null, sesgo: number | null = null;
    try {
        if (parecido) {
            const hu = await prisma.huellaObjeto.findUnique({ where: { objetoId: parecido } });
            if (!hu) return NextResponse.json({ error: "Esa pista todavía no tiene huella" }, { status: 404 });
            consulta = deInt8(hu.vector, hu.escala);
        } else {
            const t = await vectorDeTexto(q);
            consulta = t.v; escala = t.escala; sesgo = t.sesgo;
        }
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "omni-vision no contestó" }, { status: 502 });
    }

    const desde = new Date(Date.now() - h * 3600_000);
    const filtros = Prisma.sql`o."primeraVez" >= ${desde}${camara ? Prisma.sql` AND o."deviceId" = ${camara}` : Prisma.empty}${grupo ? Prisma.sql` AND o.grupo = ${grupo}` : Prisma.empty}`;
    const [huellas, sinHuella] = await Promise.all([
        prisma.$queryRaw<{ id: string; vector: Buffer; escala: number }[]>`
            SELECT h."objetoId" AS id, h.vector, h.escala FROM "HuellaObjeto" h JOIN "ObjetoVisto" o ON o.id = h."objetoId"
            WHERE ${filtros} LIMIT ${CANDIDATOS_MAX}`,
        prisma.$queryRaw<{ n: number }[]>`
            SELECT count(*)::int AS n FROM "ObjetoVisto" o LEFT JOIN "HuellaObjeto" h ON h."objetoId" = o.id
            WHERE h."objetoId" IS NULL AND o.recorte IS NOT NULL AND ${filtros}`,
    ]);
    const puntos = huellas.map((x) => {
        const q8 = new Int8Array(x.vector.buffer, x.vector.byteOffset, x.vector.byteLength);
        let d = 0, n = 0;
        for (let i = 0; i < q8.length; i++) { d += q8[i] * consulta[i]; n += q8[i] * q8[i]; }
        return { id: x.id, coseno: d / (Math.sqrt(n) || 1) };
    }).filter((x) => x.id !== parecido).sort((a, b) => b.coseno - a.coseno).slice(0, RESULTADOS);

    const filas = puntos.length ? await prisma.objetoVisto.findMany({ where: { id: { in: puntos.map((p) => p.id) } } }) : [];
    const porId = new Map(filas.map((f) => [f.id, f]));
    const catalogo = filas.some((f) => Array.isArray(f.textos) && (f.textos as any[]).length) ? await leerCatalogo().catch(() => []) : [];
    const resultados = puntos.map((p) => {
        const f = porId.get(p.id);
        if (!f) return null;
        const textos = Array.isArray(f.textos) ? (f.textos as any[]).map((t) => ({ ...t, sobreimpreso: false })) : null;
        const marcados = textos?.length ? empresasEnTextos(textos, catalogo as any, normalizarNombre) : null;
        // La probabilidad de SigLIP (sigmoide de escala·coseno + sesgo) sólo tiene sentido texto↔imagen.
        const prob = escala != null && sesgo != null ? 1 / (1 + Math.exp(-(escala * p.coseno + sesgo))) : null;
        return {
            ...f, textos: marcados && marcados.length ? marcados : null, empresa: (marcados?.find((t: any) => t.empresa) as any)?.empresa || null,
            coseno: Math.round(p.coseno * 1000) / 1000, prob: prob != null ? Math.round(prob * 1000) / 1000 : null,
        };
    }).filter(Boolean);
    return NextResponse.json({
        resultados, comparados: huellas.length, sinHuella: sinHuella[0]?.n ?? 0, h, ms: Date.now() - t0,
        modo: parecido ? "parecido" : "texto",
    }, { headers: { "Cache-Control": "no-store" } });
}
