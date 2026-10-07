import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";

/**
 * Caché en disco de las miniaturas que /api/files genera con `?w=`.
 *
 * Una captura de LPR pesa 1–2 MB y no cambia nunca; la miniatura de 320 px pesa 15 KB. Sin
 * caché, cada visita al explorador de MinIO volvía a bajar y reducir 200 fotos (segundos de
 * CPU y de red interna) aunque fueran las mismas de hace cinco minutos. Acá queda cada
 * miniatura por (bucket, clave, ancho); el navegador además la cachea un año.
 *
 * Vive en el tmp del sistema: perderla no pierde nada, se regenera. El tope de tamaño evita
 * que crezca sin fin: cuando pasa, se borran las más viejas hasta bajar a la mitad.
 */
export const DIR_MINIATURAS = process.env.THUMBS_DIR || path.join(os.tmpdir(), "omniaccess-miniaturas");
/** Tope del directorio. 500 MB son ~30.000 miniaturas de 320 px: meses de capturas. */
const TOPE_BYTES = Number(process.env.THUMBS_MAX_MB || 500) * 1024 * 1024;
/** Cada cuántas escrituras se mide el directorio (medirlo en cada una sería más caro que la miniatura). */
const CADA_CUANTAS = 200;
let escrituras = 0;

export function rutaMiniatura(bucket: string, key: string, ancho: number): string {
    const hash = crypto.createHash("sha1").update(`${bucket}/${key}`).digest("hex");
    return path.join(DIR_MINIATURAS, hash.slice(0, 2), `${hash}_${ancho}.jpg`);
}

export async function guardarMiniatura(ruta: string, datos: Buffer): Promise<void> {
    await fs.mkdir(path.dirname(ruta), { recursive: true });
    // Escritura atómica: si dos pedidos generan la misma miniatura a la vez, ninguno lee una a medias.
    const tmp = `${ruta}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, datos);
    await fs.rename(tmp, ruta);
    if (++escrituras % CADA_CUANTAS === 0) limpiarCacheMiniaturas().catch(() => null);
}

export async function limpiarCacheMiniaturas(): Promise<{ antes: number; despues: number; borradas: number }> {
    const archivos: { ruta: string; bytes: number; mtime: number }[] = [];
    let total = 0;
    async function recorrer(dir: string) {
        let entradas: any[] = [];
        try { entradas = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entradas) {
            const r = path.join(dir, e.name);
            if (e.isDirectory()) await recorrer(r);
            else { try { const st = await fs.stat(r); archivos.push({ ruta: r, bytes: st.size, mtime: st.mtimeMs }); total += st.size; } catch { } }
        }
    }
    await recorrer(DIR_MINIATURAS);
    const antes = total;
    let borradas = 0;
    if (total > TOPE_BYTES) {
        archivos.sort((a, b) => a.mtime - b.mtime);
        for (const a of archivos) {
            if (total <= TOPE_BYTES / 2) break;
            try { await fs.unlink(a.ruta); total -= a.bytes; borradas++; } catch { }
        }
    }
    return { antes, despues: total, borradas };
}
