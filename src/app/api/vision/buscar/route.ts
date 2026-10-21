import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { VISION_URL, empresasEnTextos } from "@/lib/vision";
import { leerCatalogo } from "@/lib/empresas-servidor";
import { normalizarNombre } from "@/lib/empresas";
import { Prisma } from "@prisma/client";
import { equiposDeArea } from "@/lib/areas-historial";
import { historialDePistas, pareceChapa, pasosDeChapa, pistasDePasos, type PasoChapa } from "@/lib/vision-historial";

export const dynamic = "force-dynamic";

/**
 * GET /api/vision/buscar?q=camioneta blanca con escalera  ·  ?parecido=<objetoId>
 *   &h=24|168|720  &camara=<deviceId>  &grupo=persona|vehiculo|animal|objeto  &area=<id>|__sin_area
 *   (area: sólo lo de las cámaras de esa área de Dispositivos y las de adentro — 21/10, Nico:
 *   «la búsqueda de parecidos debe poder indicarse en qué área se desea buscar»)
 *
 * Busca en el registro de detecciones por CÓMO SE VE: la frase (o el recorte de otra pista) se
 * convierte en un vector de SigLIP 2 y se compara por coseno con la huella del recorte de cada
 * pista (HuellaObjeto, ver vision-analisis.js). No hay índice vectorial en la base: las huellas
 * del rango se traen y se comparan acá (30 días de un barrio son decenas de miles, unos
 * milisegundos de cuentas).
 *
 * La frase se manda tal cual y como «una foto de …», y se promedian: SigLIP aprendió de textos
 * que describen fotos, y el promedio es más estable que cualquiera de las dos sola.
 *
 * POST /api/vision/buscar?h=…&camara=…&grupo=… con una imagen (image/jpeg o image/png) en el
 * cuerpo: busca lo parecido a ESA foto (subida o sacada con el celular). Es lo mismo que «buscar
 * parecidos» pero con un recorte que no salió de las cámaras: SigLIP da el vector y se compara
 * igual. La pantalla manda el recorte del objeto elegido, no la foto entera, porque las huellas
 * son de recortes: una foto de una calle entera no se parece a ningún recorte.
 * POST /api/vision/buscar?objetos=1 con la foto: qué personas, vehículos y animales hay en ella
 * (para elegir cuál buscar).
 */
const RANGOS_H = new Set([24, 168, 720]);
/** Cuántos resultados se devuelven: lo que se mira de una vez en la grilla. */
const RESULTADOS = 60;
/** Tope de huellas que se comparan: un rango de 30 días con todo el barrio no pasa de esto. */
const CANDIDATOS_MAX = 80_000;
const PLANTILLAS = (q: string) => [q, `una foto de ${q}`];
const TIEMPO_MS = 20_000;
/** Una foto de celular pasa de 4 MB; omni-vision acepta hasta 15. Más que esto no es una foto. */
const FOTO_MAX_BYTES = 12 * 1024 * 1024;
/** Lo que se ofrece para elegir en la foto subida: lo mismo que registran las cámaras. */
const GRUPOS_FOTO = "persona,vehiculo,animal,objeto";

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

function rango(sp: URLSearchParams) {
    const hq = Number(sp.get("h"));
    return { h: RANGOS_H.has(hq) ? hq : 168, camara: sp.get("camara") || null, grupo: sp.get("grupo") || null, area: sp.get("area") || null };
}

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("La búsqueda no es una vista de pantalla.");
    const sp = req.nextUrl.searchParams;
    const q = String(sp.get("q") || "").trim().slice(0, 200);
    const parecido = sp.get("parecido");
    if (!q && !parecido) return NextResponse.json({ error: "Escribí qué buscar" }, { status: 400 });
    const t0 = Date.now();

    // Una matrícula no se busca por cómo se ve («SBX1234» no describe nada para SigLIP): se busca
    // en el historial de accesos, y de cada paso se traen las pistas de OmniVision del vehículo.
    const chapa = !parecido && q ? pareceChapa(q) : null;
    if (chapa) {
        const r = rango(sp);
        const pasos = await pasosDeChapa(chapa, new Date(Date.now() - r.h * 3600_000));
        const pistas = await pistasDePasos(pasos);
        return responder(pistas.map((f) => ({ f, coseno: 1, prob: null })), { comparados: pasos.length, sinHuella: 0, h: r.h, t0, modo: "chapa", pasos });
    }

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
    return comparar(consulta, escala, sesgo, rango(sp), parecido, parecido ? "parecido" : "texto", t0);
}

/** Con una foto: los objetos que hay en ella, o lo parecido a ella (ver arriba). */
export async function POST(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("La búsqueda no es una vista de pantalla.");
    const tipo = req.headers.get("content-type") || "";
    if (!/^image\/(jpeg|png|webp)/.test(tipo)) return NextResponse.json({ error: "Mandá una foto (JPG, PNG o WebP)" }, { status: 415 });
    const datos = Buffer.from(await req.arrayBuffer());
    if (!datos.length) return NextResponse.json({ error: "No llegó la foto" }, { status: 400 });
    if (datos.length > FOTO_MAX_BYTES) return NextResponse.json({ error: "La foto pesa demasiado" }, { status: 413 });
    const sp = req.nextUrl.searchParams;
    const t0 = Date.now();
    try {
        if (sp.get("objetos") === "1") {
            const r = await fetch(`${VISION_URL()}/detectar?grupos=${GRUPOS_FOTO}`, { method: "POST", body: datos, headers: { "content-type": tipo }, cache: "no-store", signal: AbortSignal.timeout(TIEMPO_MS) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `omni-vision respondió ${r.status}`);
            const objetos = (j.objetos || []).map((o: any) => ({ caja: o.caja_norm, clase: o.clase, grupo: o.grupo, confianza: o.confianza }));
            return NextResponse.json({ objetos, ms: Date.now() - t0 }, { headers: { "Cache-Control": "no-store" } });
        }
        const r = await fetch(`${VISION_URL()}/vector`, { method: "POST", body: datos, headers: { "content-type": tipo }, cache: "no-store", signal: AbortSignal.timeout(TIEMPO_MS) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `omni-vision respondió ${r.status}`);
        return comparar(normalizar(Float32Array.from(j.vector as number[])), null, null, rango(sp), null, "foto", t0);
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "omni-vision no contestó" }, { status: 502 });
    }
}

async function comparar(consulta: Float32Array, escala: number | null, sesgo: number | null, { h, camara, grupo, area }: { h: number; camara: string | null; grupo: string | null; area?: string | null },
    parecido: string | null, modo: "texto" | "parecido" | "foto", t0: number) {
    // Texto UTC sin zona: la columna es `timestamp` y la sesión está en hora local; un Date
    // corría el rango 3 h (ver sinZona en vision-analisis.js).
    const desde = new Date(Date.now() - h * 3600_000).toISOString().replace("T", " ").replace("Z", "");
    const enArea = await equiposDeArea(area);
    // «Sin área» incluye las cámaras RTSP de OmniVision que no son un equipo (deviceId vacío).
    const filtroArea = !enArea ? Prisma.empty
        : "en" in enArea ? (enArea.en.length ? Prisma.sql` AND o."deviceId" IN (${Prisma.join(enArea.en)})` : Prisma.sql` AND false`)
        : enArea.fuera.length ? Prisma.sql` AND (o."deviceId" IS NULL OR o."deviceId" NOT IN (${Prisma.join(enArea.fuera)}))` : Prisma.empty;
    const filtros = Prisma.sql`o."primeraVez" >= ${desde}::timestamp${camara ? Prisma.sql` AND o."deviceId" = ${camara}` : Prisma.empty}${grupo ? Prisma.sql` AND o.grupo = ${grupo}` : Prisma.empty}${filtroArea}`;
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
    const lista = puntos.map((p) => {
        const f = porId.get(p.id);
        // La probabilidad de SigLIP (sigmoide de escala·coseno + sesgo) sólo tiene sentido texto↔imagen.
        const prob = escala != null && sesgo != null ? 1 / (1 + Math.exp(-(escala * p.coseno + sesgo))) : null;
        return f ? { f, coseno: p.coseno, prob } : null;
    }).filter((x): x is NonNullable<typeof x> => !!x);
    return responder(lista, { comparados: huellas.length, sinHuella: sinHuella[0]?.n ?? 0, h, t0, modo });
}

/** Arma la respuesta: el rotulado con su empresa y lo que el historial sabe de cada pista. */
async function responder(lista: { f: any; coseno: number; prob: number | null }[],
    m: { comparados: number; sinHuella: number; h: number; t0: number; modo: "texto" | "parecido" | "foto" | "chapa"; pasos?: PasoChapa[] }) {
    const filas = lista.map((x) => x.f);
    // El tipo de cámara: decide si el resultado se abre en la ficha de intrusión o en el visor (Historial, 21/10).
    const idsCam = [...new Set(filas.map((f) => f.deviceId).filter(Boolean))] as string[];
    const tipoCam = new Map(idsCam.length ? (await prisma.device.findMany({ where: { id: { in: idsCam } }, select: { id: true, deviceType: true } })).map((d) => [d.id, String(d.deviceType)]) : []);
    const [catalogo, historial] = await Promise.all([
        filas.some((f) => Array.isArray(f.textos) && (f.textos as any[]).length) ? leerCatalogo().catch(() => []) : Promise.resolve([]),
        historialDePistas(filas).catch(() => new Map()),
    ]);
    const resultados = lista.map(({ f, coseno, prob }) => {
        const textos = Array.isArray(f.textos) ? (f.textos as any[]).map((t) => ({ ...t, sobreimpreso: false })) : null;
        const marcados = textos?.length ? empresasEnTextos(textos, catalogo as any, normalizarNombre) : null;
        return {
            ...f, textos: marcados && marcados.length ? marcados : null, empresa: (marcados?.find((t: any) => t.empresa) as any)?.empresa || null,
            coseno: Math.round(coseno * 1000) / 1000, prob: prob != null ? Math.round(prob * 1000) / 1000 : null,
            historial: historial.get(f.id) || null,
            tipoCamara: f.deviceId ? tipoCam.get(f.deviceId) || null : null,
        };
    });
    return NextResponse.json({
        resultados, comparados: m.comparados, sinHuella: m.sinHuella, h: m.h, ms: Date.now() - m.t0, modo: m.modo, pasos: m.pasos || null,
    }, { headers: { "Cache-Control": "no-store" } });
}

