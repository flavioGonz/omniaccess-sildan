import { prisma } from "@/lib/prisma";

/**
 * Cómo se entregan los clips de grabación: resolución, calidad, formato y nombre.
 *
 * Son los ajustes de Ajustes → Video del evento, al lado de la ventana de segundos. Antes
 * todo esto estaba escrito en las rutas (720p, crf 26, "clip_ch3_2026…mp4", el ZIP de la
 * ficha) y no había manera de que el barrio pidiera "los clips en 1080 y con la matrícula
 * en el nombre" sin tocar código. Un solo lugar lo lee: la ruta de playback (ver / bajar
 * un clip) y la de exportación de la ficha del evento.
 */

export const AJUSTE_CLIP_ALTURA = "CLIP_ALTURA";
export const AJUSTE_CLIP_CALIDAD = "CLIP_CALIDAD";
export const AJUSTE_CLIP_NOMBRE = "CLIP_NOMBRE";
export const AJUSTE_CLIP_ENTREGA = "CLIP_ENTREGA";

/** 0 = tal cual graba el NVR (1080p/1440p: pesa y tarda más en transcodificar). */
export const ALTURAS_CLIP = [480, 720, 1080, 0] as const;
export type AlturaClip = (typeof ALTURAS_CLIP)[number];
export type CalidadClip = "alta" | "media" | "baja";
export type EntregaClip = "mp4" | "zip";

export type ConfigClip = { altura: AlturaClip; calidad: CalidadClip; nombre: string; entrega: EntregaClip };

export const CLIP_POR_DEFECTO: ConfigClip = { altura: 720, calidad: "media", nombre: "{camara}_{matricula}_{fecha}_{hora}", entrega: "zip" };

/**
 * CRF de x264 por calidad. 22 ya es visualmente igual al original en estas cámaras; 30
 * se nota en el detalle de la chapa pero pesa un tercio. Por eso "media" es 26.
 */
export const CRF_POR_CALIDAD: Record<CalidadClip, number> = { alta: 22, media: 26, baja: 30 };

export const TOKENS_NOMBRE = ["{camara}", "{matricula}", "{fecha}", "{hora}", "{canal}", "{evento}"] as const;

export async function configClips(): Promise<ConfigClip> {
    try {
        const filas = await prisma.setting.findMany({ where: { key: { in: [AJUSTE_CLIP_ALTURA, AJUSTE_CLIP_CALIDAD, AJUSTE_CLIP_NOMBRE, AJUSTE_CLIP_ENTREGA] } } });
        const v = (k: string) => filas.find((f) => f.key === k)?.value;
        const altura = Number(v(AJUSTE_CLIP_ALTURA));
        const calidad = v(AJUSTE_CLIP_CALIDAD) as CalidadClip;
        const entrega = v(AJUSTE_CLIP_ENTREGA) as EntregaClip;
        return {
            altura: (ALTURAS_CLIP as readonly number[]).includes(altura) ? (altura as AlturaClip) : CLIP_POR_DEFECTO.altura,
            calidad: calidad in CRF_POR_CALIDAD ? calidad : CLIP_POR_DEFECTO.calidad,
            nombre: (v(AJUSTE_CLIP_NOMBRE) || "").trim() || CLIP_POR_DEFECTO.nombre,
            entrega: entrega === "mp4" || entrega === "zip" ? entrega : CLIP_POR_DEFECTO.entrega,
        };
    } catch { return CLIP_POR_DEFECTO; }
}

/** El filtro de video para ffmpeg según la altura elegida (sin GPU; con VAAPI lo arma la ruta). */
export function filtroEscala(altura: AlturaClip): string {
    return altura ? `scale=-2:${altura},format=yuv420p` : "format=yuv420p";
}

/** El nombre del archivo a partir del patrón: sólo letras, números, guiones y puntos; sin extensión. */
export function nombreDeClip(patron: string, datos: { camara?: string | null; matricula?: string | null; fecha: Date; canal?: number | string | null; evento?: string | null }): string {
    const p = (n: number) => String(n).padStart(2, "0");
    const d = datos.fecha;
    const valores: Record<string, string> = {
        "{camara}": datos.camara || "camara",
        "{matricula}": datos.matricula && datos.matricula !== "unknown" ? datos.matricula : "sin-matricula",
        "{fecha}": `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`,
        "{hora}": `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`,
        "{canal}": datos.canal != null ? `ch${datos.canal}` : "",
        "{evento}": datos.evento || "",
    };
    let nombre = patron || CLIP_POR_DEFECTO.nombre;
    for (const [k, v] of Object.entries(valores)) nombre = nombre.split(k).join(v);
    nombre = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    return nombre || "clip";
}
