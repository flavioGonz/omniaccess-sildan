import { getCompreFace } from "@/lib/compareface";

/**
 * El rostro dibujado EN VIVO sobre el video de un portero, y la distancia de captura.
 *
 * Pedido de Nico (18/11): «los canales que son porteros faciales deben tener el recuadro del
 * rostro dibujado en la grilla y live view, estilizado para la detección» y «quiero poder ajustar
 * la distancia de captura facial como un recuadro dibujado del rostro sobre el video,
 * configurable; el objetivo es resolver la distancia de captura para OmniVision».
 *
 * Las dos cosas son la misma pantalla y resuelven el mismo problema. Hoy el tamaño mínimo de cara
 * es un número en Ajustes (`FACE_PX_MIN`) y nadie puede saber, mirando un portero, si la cara de
 * quien toca el timbre llega a ese tamaño: se descubre después, cuando las pasadas salen
 * «Desconocido». Dibujando las dos cosas juntas —la cara que se ve ahora y el recuadro mínimo—
 * la pregunta «¿a qué distancia tengo que ponerlo?» se contesta mirando, no probando.
 *
 * Por qué CompreFace y no omni-vision: el vivo de siluetas le pide a omni-vision
 * `persona, vehiculo, animal, propio` — caras no detecta. Quien sí las detecta es CompreFace, que
 * ya está integrado y es el mismo motor que después compara. Se le manda el MISMO cuadro que ya
 * se saca para las siluetas (no hay un segundo ffmpeg ni un segundo stream) y las dos consultas
 * salen a la vez, así el ritmo no se parte en dos.
 *
 * Sólo en equipos que miran personas de cerca: en una cámara de calle la cara es de 14 px y
 * pedirle rostros a cada cuadro sería gastar la GPU para dibujar nada.
 */

/** Los tipos de equipo donde el objeto es la cara y no el cuerpo. */
export const TIPOS_CARA = ["DOOR_INTERCOM", "ACCESS_CONTROL", "FACE_TERMINAL"] as const;

/**
 * El alto de cara mínimo, como fracción del alto del cuadro, cuando el equipo no tiene el suyo.
 *
 * 0,12 sale de la medición del 13/11 que está en vision-rostros.js: en el cuadro de 640×360 la
 * cara medía 14 a 20 px en dos de cada tres pasadas y el motor no podía comparar ninguna. El
 * motor pide `FACE_PX_MIN` px de alto (80 de fábrica); sobre un cuadro de 720 de alto eso es
 * 0,11. Se deja 0,12 para no quedar justo en el borde, y cada equipo puede tener el suyo.
 */
export const CARA_MIN_FRAC = 0.12;
/** El mínimo y el máximo que se pueden configurar: menos no lo compara nadie, más no entra en la puerta. */
export const CARA_MIN_RANGO = { min: 0.04, max: 0.6 };

/** El Setting por equipo. Es un Setting y no una columna para no migrar la base por un número. */
export const claveCaraMin = (deviceId: string) => `FACE_CARA_MIN_${deviceId}`;

export type CaraVista = {
    /** Normalizada 0-1, como todo lo que dibuja CapaAnalisis. */
    caja: [number, number, number, number];
    /** 0 a 1. */
    prob: number;
    /** A quién reconoció el motor en esta cara, si reconoció a alguien. */
    nombre?: string | null;
    /** Qué tan parecida, 0 a 100. */
    similitud?: number | null;
};

/** Lee el valor guardado y lo deja dentro del rango. Sin valor, el de fábrica. */
export function caraMinDe(valor: string | null | undefined): number {
    const n = Number(valor);
    if (!Number.isFinite(n) || n <= 0) return CARA_MIN_FRAC;
    return Math.min(CARA_MIN_RANGO.max, Math.max(CARA_MIN_RANGO.min, n));
}

/** El alto de una cara como fracción del alto del cuadro. */
export const altoDeCara = (c: CaraVista): number => Math.max(0, c.caja[3] - c.caja[1]);

/** ¿Esta cara alcanza el tamaño que el motor necesita para comparar? */
export const caraAlcanza = (c: CaraVista, min: number): boolean => altoDeCara(c) >= min;

/**
 * Las caras del cuadro, normalizadas, CON NOMBRE si el motor reconoce a alguien.
 *
 * Se usa `/recognition/recognize` y no `/detection/detect`: cuesta lo mismo (una llamada por
 * cuadro) y además devuelve a quién se parece esa cara. Con eso el recuadro puede cambiar de
 * color cuando reconoce (18/11, pedido de Nico) en vez de mostrar siempre lo mismo. Si no hay
 * clave de reconocimiento se cae a la detección, que al menos dibuja dónde está la cara.
 *
 * Nunca tira: si el motor no contesta, se devuelve `null` y el vivo sigue mostrando lo demás —
 * una cara que no se pudo mirar no es una cara que no está, y por eso `null` (no se dibuja nada)
 * y no `[]` (se miró y no hay nadie).
 */
export async function carasDelCuadro(jpeg: Buffer, anchoPx: number, altoPx: number, msMax = 2500): Promise<CaraVista[] | null> {
    try {
        const { url, detKey, recoKey } = await getCompreFace();
        if (!url || !(recoKey || detKey)) return null;
        const reconociendo = !!recoKey;
        const ruta = reconociendo
            ? "/api/v1/recognition/recognize?det_prob_threshold=0.75&prediction_count=1&face_plugins="
            : "/api/v1/detection/detect?det_prob_threshold=0.75&face_plugins=";
        const fd = new FormData();
        fd.append("file", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "cuadro.jpg");
        const r = await fetch(`${url}${ruta}`, {
            method: "POST", body: fd, headers: { "x-api-key": reconociendo ? recoKey : detKey }, signal: AbortSignal.timeout(msMax),
        });
        const j = await r.json().catch(() => null) as { result?: { box?: Record<string, number>; subjects?: { subject?: string; similarity?: number }[] }[]; code?: number } | null;
        /* «No face is found in the given image» viene como 400 con code 28, y NO es un fallo: es
           la respuesta «no hay nadie». Medido el 18/11 contra el portero con la puerta vacía. Si
           esto devolviera `null`, el recuadro de referencia tampoco se dibujaría y justamente se
           quiere ver con la puerta vacía, para ajustar la distancia. */
        if (j?.code === 28) return [];
        if (!r.ok) return null;
        if (!j?.result) return null;
        const W = anchoPx || 1, H = altoPx || 1;
        return j.result
            .filter((f) => !!f.box)
            .map((f) => {
                const b = f.box as Record<string, number>;
                const s0 = f.subjects?.[0];
                return {
                    caja: [b.x_min / W, b.y_min / H, b.x_max / W, b.y_max / H] as [number, number, number, number],
                    prob: Number(b.probability) || 0,
                    nombre: s0?.subject || null,
                    similitud: s0?.similarity != null ? Math.round(s0.similarity * 100) : null,
                };
            })
            .filter((c) => c.caja.every((v) => Number.isFinite(v)));
    } catch { return null; }
}
