import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { VISION_URL } from "@/lib/vision";

/**
 * La búsqueda por cómo se ve (SigLIP 2), para quien no es la pantalla de OmniVision › Buscar.
 *
 * El historial buscaba con palabras exactas sobre las clases y los rasgos («moto blanca» = la
 * clase moto con el rasgo blanco): no encontraba «camioneta de reparto» ni «persona con paraguas»,
 * que OmniVision › Buscar sí encuentra porque compara la FRASE con la huella del recorte de cada
 * pista. Esto es esa misma comparación, para usarla también desde el historial.
 *
 * Igual que en /api/vision/buscar: la frase va tal cual y como «una foto de …» y se promedian, y
 * las huellas del rango se traen y se comparan acá (no hay índice vectorial: son decenas de miles
 * de recortes por mes, milisegundos de cuentas).
 */

const PLANTILLAS = (q: string) => [q, `una foto de ${q}`];
const TIEMPO_MS = 15_000;
/** Tope de huellas que se comparan: 30 días de todo un barrio no pasan de esto. */
const CANDIDATOS_MAX = 80_000;
/**
 * Probabilidad SigLIP mínima para contar como «se parece». La misma que usa Buscar para separar
 * los posibles del resto (medida el 9/10 sobre ~1.800 pistas: sin nada que encontrar, el mejor
 * nunca pasó de 0,007).
 */
export const PROB_PARECE = 0.01;

const sinZona = (d: Date) => d.toISOString().replace("T", " ").replace("Z", "");

export function normalizar(v: Float32Array) {
    let n = 0; for (let i = 0; i < v.length; i++) n += v[i] * v[i];
    n = Math.sqrt(n) || 1; for (let i = 0; i < v.length; i++) v[i] /= n;
    return v;
}

export async function vectorDeTexto(q: string): Promise<{ v: Float32Array; escala: number; sesgo: number }> {
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

export type ObjetoParecido = { id: string; deviceId: string | null; camara: string; clase: string; grupo: string; primeraVez: Date; ultimaVez: Date; recorte: string | null; coseno: number; prob: number };

/**
 * Las pistas de OmniVision que se parecen a una frase, de la más parecida a la menos, con su
 * probabilidad. Sólo las que pasan PROB_PARECE.
 */
export async function objetosPorTexto(q: string, { desde, hasta, limite = 200 }: { desde: Date | null; hasta: Date | null; limite?: number }): Promise<ObjetoParecido[]> {
    const { v, escala, sesgo } = await vectorDeTexto(q);
    const filtro = Prisma.sql`${desde ? Prisma.sql`AND o."primeraVez" >= ${sinZona(desde)}::timestamp` : Prisma.empty} ${hasta ? Prisma.sql`AND o."primeraVez" <= ${sinZona(hasta)}::timestamp` : Prisma.empty}`;
    const huellas = await prisma.$queryRaw<{ id: string; vector: Buffer }[]>`
        SELECT h."objetoId" AS id, h.vector FROM "HuellaObjeto" h JOIN "ObjetoVisto" o ON o.id = h."objetoId"
        WHERE true ${filtro} ORDER BY o."primeraVez" DESC LIMIT ${CANDIDATOS_MAX}`;
    const puntos = huellas.map((x) => {
        const q8 = new Int8Array(x.vector.buffer, x.vector.byteOffset, x.vector.byteLength);
        let d = 0, n = 0;
        for (let i = 0; i < q8.length; i++) { d += q8[i] * v[i]; n += q8[i] * q8[i]; }
        const coseno = d / (Math.sqrt(n) || 1);
        return { id: x.id, coseno, prob: 1 / (1 + Math.exp(-(escala * coseno + sesgo))) };
    }).filter((p) => p.prob >= PROB_PARECE).sort((a, b) => b.coseno - a.coseno).slice(0, limite);
    if (!puntos.length) return [];
    const filas = await prisma.objetoVisto.findMany({
        where: { id: { in: puntos.map((p) => p.id) } },
        select: { id: true, deviceId: true, camara: true, clase: true, grupo: true, primeraVez: true, ultimaVez: true, recorte: true },
    });
    const porId = new Map(filas.map((f) => [f.id, f]));
    return puntos.map((p) => { const f = porId.get(p.id); return f ? { ...f, coseno: p.coseno, prob: p.prob } : null; }).filter(Boolean) as ObjetoParecido[];
}

/** Cuánto antes y después de una pista se busca el acceso de la misma cámara: el auto pasa en segundos. */
const MARGEN_ACCESO_MS = 15_000;

/**
 * Los accesos que corresponden a esas pistas: misma cámara, dentro del rato en que la pista
 * estuvo a la vista (con un margen). Así «camioneta de reparto» trae la fila del portón donde
 * pasó esa camioneta, aunque la foto del acceso nunca se haya analizado con esas palabras.
 */
export async function accesosDeObjetos(objetos: ObjetoParecido[]): Promise<string[]> {
    const conCamara = objetos.filter((o) => o.deviceId);
    if (!conCamara.length) return [];
    const partes = conCamara.map((o) => Prisma.sql`(e."deviceId" = ${o.deviceId} AND e.timestamp BETWEEN ${sinZona(new Date(+o.primeraVez - MARGEN_ACCESO_MS))}::timestamp AND ${sinZona(new Date(+o.ultimaVez + MARGEN_ACCESO_MS))}::timestamp)`);
    const filas = await prisma.$queryRaw<{ id: string }[]>`SELECT e.id FROM "AccessEvent" e WHERE ${Prisma.join(partes, " OR ")} LIMIT 500`;
    return filas.map((f) => f.id);
}
