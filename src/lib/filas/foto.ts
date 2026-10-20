import https from "https";
import { uploadToS3 } from "@/lib/s3";
import { esCanalAforo, FOTO_DESDE_PERSONAS, FOTO_INTERVALO_MS } from "@/lib/filas/constantes";

/**
 * La foto de una lectura de fila: UN criterio para las dos vías por las que llega el aforo (el
 * push de la Bosch en /api/onvif/notify y el sondeo de lib/onvif-polling). Antes cada una tenía
 * su copia de grabSnapshot y su regla, y la del sondeo casi nunca sacaba foto (ver constantes).
 *
 * El estado del intervalo vive en globalThis: las rutas de Next pueden cargar este módulo más de
 * una vez, y un Map por copia dejaría pasar el doble de fotos.
 */

type Ultima = { t: number; personas: number };
const g = globalThis as unknown as { __fotoFila?: Map<string, Ultima> };
const ultimas: Map<string, Ultima> = (g.__fotoFila ||= new Map());

/** Tiempo máximo para pedir el cuadro: la lectura espera a la foto antes de guardarse. */
const TOPE_CUADRO_MS = 5_000;
/** Un JPEG de menos de esto es una página de error, no una foto. */
const BYTES_MINIMOS = 1_000;

export type CamaraFila = { id: string; ip: string | null; username: string | null; password: string | null };

/** ¿Esta lectura lleva foto? Sólo aforo, desde FOTO_DESDE_PERSONAS, y sin repetir el parpadeo. */
export function correspondeFoto(deviceId: string, canal: string | null | undefined, personas: number, ahora = Date.now()): boolean {
    if (!esCanalAforo(canal) || personas < FOTO_DESDE_PERSONAS) return false;
    const u = ultimas.get(deviceId);
    if (u && personas <= u.personas && ahora - u.t < FOTO_INTERVALO_MS) return false;
    return true;
}

/** El cuadro actual de la cámara (snap.jpg de la Bosch), o null. */
export function cuadroBosch(cam: CamaraFila): Promise<Buffer | null> {
    if (!cam.ip) return Promise.resolve(null);
    return new Promise((resolve) => {
        try {
            const auth = Buffer.from(`${cam.username || "admin"}:${cam.password || ""}`).toString("base64");
            const req = https.request({
                hostname: cam.ip!, port: 443, path: "/snap.jpg?JpegSize=L", method: "GET",
                headers: { Authorization: `Basic ${auth}` },
                agent: new https.Agent({ rejectUnauthorized: false }), timeout: TOPE_CUADRO_MS,
            }, (res) => {
                if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
                const partes: Buffer[] = [];
                res.on("data", (c: Buffer) => partes.push(c));
                res.on("end", () => { const b = Buffer.concat(partes); resolve(b.length >= BYTES_MINIMOS ? b : null); });
                res.on("error", () => resolve(null));
            });
            req.on("error", () => resolve(null));
            req.on("timeout", () => { req.destroy(); resolve(null); });
            req.end();
        } catch { resolve(null); }
    });
}

/**
 * Saca y guarda la foto si corresponde. Devuelve la ruta servible (/api/files/queue/…) o null.
 * Nunca lanza: una lectura sin foto se guarda igual.
 */
export async function fotoDeLectura(cam: CamaraFila, canal: string | null | undefined, personas: number): Promise<string | null> {
    const ahora = Date.now();
    if (!correspondeFoto(cam.id, canal, personas, ahora)) return null;
    // Se anota ANTES de pedir el cuadro: dos lecturas que llegan juntas no piden dos fotos.
    ultimas.set(cam.id, { t: ahora, personas });
    const buf = await cuadroBosch(cam);
    if (!buf) return null;
    try { return await uploadToS3(buf, `queue/${cam.id}/${ahora}.jpg`, "image/jpeg", "queue"); }
    catch (e: any) { console.error(`[foto-fila] no se pudo guardar: ${e?.message || e}`); return null; }
}
