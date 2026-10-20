import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { getS3Client } from "@/lib/s3";
import { limitesPorFila } from "@/lib/filas/demora";
import {
    AJUSTE_FOTOS_DIAS, AJUSTE_FOTOS_COMPLETAS_DIAS, FOTOS_DIAS_POR_DEFECTO, FOTOS_COMPLETAS_DIAS_POR_DEFECTO,
    FOTOS_TRAMO_MIN, FOTOS_DIAS_MAX, LIMITE_FILA_POR_DEFECTO, CANAL_ENTRADA, CANAL_SALIDA,
} from "@/lib/filas/constantes";

/**
 * Retención de las fotos de las filas (HB, 19/10: «mejorar la retención»).
 *
 * Antes no había ninguna: las fotos se acumulaban en MinIO hasta que el disco se llenaba, y
 * entonces lib/s3 borraba las 200 más viejas DE CUALQUIER BUCKET en el apuro de una subida. Ahora:
 *   · hasta AJUSTE_FOTOS_COMPLETAS_DIAS, todas;
 *   · después, por fila y por tramo de FOTOS_TRAMO_MIN minutos, la de más gente — y todas las de
 *     la fila en su límite o arriba, que son la evidencia de un aviso;
 *   · pasados AJUSTE_FOTOS_DIAS, ninguna. La lectura queda (el número sirve para los reportes);
 *     sólo se le saca la foto.
 * Se borra del bucket Y se limpia la ruta en la base: una ruta a un archivo que no existe es una
 * miniatura rota en la tabla.
 */

/** Por vuelta, para que la tarea de cada minuto nunca tarde. Lo atrasado sale en las siguientes. */
const LOTE = 1_000;
/** Cada cuánto corre, como mucho (la llama el tick de cada minuto). */
const CADA_MS = 60 * 60_000;

export type ConfigRetencion = { dias: number; completasDias: number };

const entero = (v: unknown, def: number, min: number, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

export async function configRetencion(): Promise<ConfigRetencion> {
    const filas = await prisma.setting.findMany({ where: { key: { in: [AJUSTE_FOTOS_DIAS, AJUSTE_FOTOS_COMPLETAS_DIAS] } } }).catch(() => []);
    const v = (k: string) => filas.find((f) => f.key === k)?.value;
    const dias = entero(v(AJUSTE_FOTOS_DIAS) ?? FOTOS_DIAS_POR_DEFECTO, FOTOS_DIAS_POR_DEFECTO, 1, FOTOS_DIAS_MAX);
    const completasDias = entero(v(AJUSTE_FOTOS_COMPLETAS_DIAS) ?? FOTOS_COMPLETAS_DIAS_POR_DEFECTO, FOTOS_COMPLETAS_DIAS_POR_DEFECTO, 0, dias);
    return { dias, completasDias };
}

/** "/api/files/<bucket>/<clave>" → { bucket, clave } */
function partesDe(ruta: string): { bucket: string; clave: string } | null {
    const m = /^\/api\/files\/([^/]+)\/(.+)$/.exec(ruta);
    return m ? { bucket: m[1], clave: decodeURIComponent(m[2]) } : null;
}

async function borrar(filas: { id: string; snapshotPath: string | null }[]): Promise<number> {
    if (!filas.length) return 0;
    const porBucket = new Map<string, string[]>();
    for (const f of filas) {
        const p = f.snapshotPath ? partesDe(f.snapshotPath) : null;
        if (!p) continue;
        if (!porBucket.has(p.bucket)) porBucket.set(p.bucket, []);
        porBucket.get(p.bucket)!.push(p.clave);
    }
    const s3 = await getS3Client();
    for (const [bucket, claves] of porBucket) {
        for (let i = 0; i < claves.length; i += 1000) {
            const tramo = claves.slice(i, i + 1000);
            try { await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: tramo.map((Key) => ({ Key })), Quiet: true } })); }
            catch (e: any) { console.error(`[retencion-filas] ${bucket}: ${e?.message || e}`); return 0; /* sin borrar, no se toca la base */ }
        }
    }
    await prisma.queueEvent.updateMany({ where: { id: { in: filas.map((f) => f.id) } }, data: { snapshotPath: null } });
    return filas.length;
}

/** Una vuelta de retención. Devuelve cuántas fotos sacó, por motivo. */
export async function purgarFotosFilas(ahora = new Date()): Promise<{ vencidas: number; adelgazadas: number }> {
    const cfg = await configRetencion();
    const dia = 24 * 3600_000;
    const tope = new Date(ahora.getTime() - cfg.dias * dia);
    const completas = new Date(ahora.getTime() - cfg.completasDias * dia);

    const vencidas = await prisma.queueEvent.findMany({
        where: { snapshotPath: { not: null }, timestamp: { lt: tope } },
        select: { id: true, snapshotPath: true }, take: LOTE,
    });
    const nVencidas = await borrar(vencidas);

    let nAdelgazadas = 0;
    if (completas > tope) {
        const limites = await limitesPorFila();
        const lim = JSON.stringify(Object.entries(limites).map(([id, l]) => ({ id, lim: l })));
        const sobrantes = await prisma.$queryRawUnsafe<{ id: string; snapshotPath: string }[]>(`
            with lim as (select * from json_to_recordset($1::json) as l(id text, lim int)),
            f as (
                select e.id, e."snapshotPath", e."peopleCount", coalesce(l.lim, $2::int) as limite,
                    row_number() over (
                        partition by e."deviceId", date_bin($3::interval, e."timestamp", timestamp '2000-01-01')
                        order by e."peopleCount" desc, e."timestamp" desc) as orden
                from "QueueEvent" e left join lim l on l.id = e."deviceId"
                where e."snapshotPath" is not null and e."timestamp" >= $4 and e."timestamp" < $5
                  and e."channelName" not in ($6, $7)
            )
            select id, "snapshotPath" from f where orden > 1 and "peopleCount" < limite limit ${LOTE}`,
            lim, LIMITE_FILA_POR_DEFECTO, `${FOTOS_TRAMO_MIN} minutes`, tope, completas, CANAL_ENTRADA, CANAL_SALIDA);
        nAdelgazadas = await borrar(sobrantes);
    }
    if (nVencidas || nAdelgazadas) console.log(`[retencion-filas] fotos: ${nVencidas} vencidas, ${nAdelgazadas} adelgazadas (${cfg.dias} días, completas ${cfg.completasDias})`);
    return { vencidas: nVencidas, adelgazadas: nAdelgazadas };
}

/** Para el tick de cada minuto: corre como mucho una vez por hora en este proceso. */
const g = globalThis as unknown as { __retencionFilas?: number };
export async function retencionSiToca(): Promise<void> {
    if (g.__retencionFilas && Date.now() - g.__retencionFilas < CADA_MS) return;
    g.__retencionFilas = Date.now();
    await purgarFotosFilas().catch((e) => console.error(`[retencion-filas] ${e?.message || e}`));
}
