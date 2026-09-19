import { spawn } from "child_process";

/**
 * Tomar un cuadro de una cámara y leerle las matrículas.
 *
 * Estaba escrito dos veces — en `/api/tracking/probe` y en `/api/tracking/frame` —, casi
 * igual pero no igual: uno recortaba por ROI y el otro no, uno devolvía la caja de la chapa
 * y el otro la tiraba, y los tiempos de espera diferían. Dos copias de la misma cosa no se
 * mantienen iguales solas; se separan, y después nadie sabe por qué la prueba de una cámara
 * da una lectura y el calibrador da otra sobre la misma imagen.
 */

const LPR = () => (process.env.OMNI_LPR_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

export type Lectura = {
    plate: string;
    confidence: number;
    /** La caja de la chapa, en píxeles del cuadro capturado (recortado, si hubo ROI). */
    box: any | null;
};

export type Recorte = { x: number; y: number; w: number; h: number } | null;

/**
 * Un solo cuadro del RTSP, en JPEG.
 *
 * El tope de tiempo existe porque una cámara que no contesta deja el proceso de ffmpeg
 * colgado, y con él la petición: sin corte, una cámara caída se lleva puesto un hilo del
 * servidor por cada intento.
 */
export function capturarCuadro(rtsp: string, opciones?: { roi?: Recorte; segundos?: number }): Promise<Buffer> {
    const { roi = null, segundos = 20 } = opciones || {};
    return new Promise((resolve, reject) => {
        const filtros: string[] = [];
        if (roi && roi.w > 0 && roi.h > 0 && (roi.w < 1 || roi.h < 1 || roi.x > 0 || roi.y > 0)) {
            // crop trabaja en píxeles; iw/ih son el ancho y el alto de entrada.
            filtros.push(`crop=iw*${roi.w}:ih*${roi.h}:iw*${roi.x}:ih*${roi.y}`);
        }
        const ff = spawn("ffmpeg", [
            "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp",
            "-i", rtsp,
            ...(filtros.length ? ["-vf", filtros.join(",")] : []),
            "-frames:v", "1", "-q:v", "3",
            "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
        ]);
        const trozos: Buffer[] = [];
        let err = "";
        const corte = setTimeout(() => {
            ff.kill("SIGKILL");
            reject(new Error("La cámara no respondió a tiempo."));
        }, segundos * 1000);
        ff.stdout.on("data", (d) => trozos.push(d));
        ff.stderr.on("data", (d) => { err += d.toString(); });
        ff.on("error", (e) => { clearTimeout(corte); reject(e); });
        ff.on("close", () => {
            clearTimeout(corte);
            const buf = Buffer.concat(trozos);
            if (buf.length < 1000) {
                return reject(new Error(err.trim().split("\n").pop() || "No llegó video del RTSP."));
            }
            resolve(buf);
        });
    });
}

/**
 * Las matrículas que Omni-LPR encuentra en un cuadro, de la más confiable a la menos.
 *
 * Devuelve el error en vez de tirarlo: que el lector no conteste es distinto de que no haya
 * matrículas, y quien llama tiene que poder decir cuál de las dos cosas pasó.
 */
export async function leerMatriculas(jpeg: Buffer): Promise<{ lecturas: Lectura[]; error: string | null }> {
    try {
        const r = await fetch(`${LPR()}/api/v1/tools/detect_and_recognize_plate/invoke`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_base64: jpeg.toString("base64") }),
            signal: AbortSignal.timeout(30000),
        });
        if (!r.ok) throw new Error(`Omni-LPR respondió ${r.status}`);
        const d: any = await r.json();
        const items = d?.content?.[0]?.data || [];
        const lecturas: Lectura[] = (Array.isArray(items) ? items : [])
            .map((i: any) => ({
                plate: String(i?.text || i?.plate || "").toUpperCase().replace(/[^A-Z0-9]/g, ""),
                confidence: Number(i?.confidence ?? i?.score ?? 0),
                box: i?.bounding_box || i?.box || i?.bbox || null,
            }))
            .filter((i: Lectura) => i.plate)
            .sort((a: Lectura, b: Lectura) => b.confidence - a.confidence);
        return { lecturas, error: null };
    } catch (e: any) {
        return { lecturas: [], error: e?.message || "Omni-LPR no respondió" };
    }
}
