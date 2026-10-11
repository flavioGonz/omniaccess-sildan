import { prisma } from "@/lib/prisma";

/**
 * Cuánto video se muestra alrededor de un evento: segundos ANTES y DESPUÉS.
 *
 * Estaba escrito fijo en cada pantalla, y distinto en cada una (10/30 en la ficha del
 * evento, 6/40 en el monitor de intrusión). Pasa a dos ajustes de la base para que el
 * barrio lo decida una sola vez y todas las pantallas lo respeten.
 *
 * Los topes no son capricho: el clip se transcodifica en tiempo real (los NVR graban en
 * H.265 y el navegador no lo reproduce), así que cada segundo "después" es un segundo de
 * espera. "Antes" no cuesta nada extra, pero más de un minuto no es un evento, es un
 * repaso, y para eso está la línea de tiempo.
 */
export const AJUSTE_SEG_ANTES = "PLAYBACK_PRE_SEG";
export const AJUSTE_SEG_DESPUES = "PLAYBACK_POST_SEG";
export const ANTES_POR_DEFECTO = 10;
export const DESPUES_POR_DEFECTO = 10;
export const ANTES_MAX = 60;
export const DESPUES_MAX = 170;
export const DESPUES_MIN = 3;

export type VentanaPlayback = { antes: number; despues: number };

const entero = (v: string | null | undefined, porDefecto: number, min: number, max: number) => {
    const n = parseInt(String(v ?? ""), 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : porDefecto;
};

export function acotarVentana(antes: unknown, despues: unknown): VentanaPlayback {
    return {
        antes: entero(antes as any, ANTES_POR_DEFECTO, 0, ANTES_MAX),
        despues: entero(despues as any, DESPUES_POR_DEFECTO, DESPUES_MIN, DESPUES_MAX),
    };
}

/** Lo que el barrio configuró en Ajustes → Video del evento; con los valores por defecto si no tocó nada. */
export async function ventanaPlayback(): Promise<VentanaPlayback> {
    try {
        const filas = await prisma.setting.findMany({ where: { key: { in: [AJUSTE_SEG_ANTES, AJUSTE_SEG_DESPUES] } } });
        const v = (k: string) => filas.find((f) => f.key === k)?.value;
        return acotarVentana(v(AJUSTE_SEG_ANTES), v(AJUSTE_SEG_DESPUES));
    } catch {
        return { antes: ANTES_POR_DEFECTO, despues: DESPUES_POR_DEFECTO };
    }
}
