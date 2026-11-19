"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import type { ComportamientoVisor } from "@/components/visor/PanelComportamiento";

/**
 * El comportamiento de una CARA: cuándo pasa, con qué frecuencia y por dónde.
 *
 * Pedido de Nico (19/11): «la ventana del evento face debe tener el botón de comportamiento, para
 * ver la frecuencia similar a git».
 *
 * Es el mismo módulo que ya existe para una matrícula —el calendario de actividad, la franja
 * día × hora y las cifras— con los mismos datos cambiados de sujeto: en vez de los pasos de una
 * chapa por los accesos, las pasadas de un rostro por las cámaras (`RostroPasada`).
 *
 * Dos cosas que NO se copian de la versión de matrículas, porque de una cara no se saben:
 *  · **entradas y salidas**: una pasada de rostro no tiene sentido (nadie midió si entró o salió),
 *    así que el perfil no las cuenta en vez de contarlas mal;
 *  · **permanencia**: se calcula entre una entrada y su salida, y sin sentido no hay par.
 * El panel ya dibuja sin eso: lo que no viene, no se muestra.
 */

/** Cuántos días de historia se miran. El mismo número que usa la ficha de una matrícula. */
const DIAS = 30;
/** Tope de pasadas: más que esto no cambia el dibujo y sí el tiempo de respuesta. */
const MAX = 600;

export async function comportamientoDeRostro(rostroId: string): Promise<ComportamientoVisor | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    const puede = permisosDeSesion(s || {});
    if (!s || !(puede.includes("historial") || puede.includes("rostros") || puede.includes("vision"))) return null;

    const desde = new Date(Date.now() - DIAS * 86_400_000);
    const pasadas = await prisma.rostroPasada.findMany({
        where: { rostroId, cuando: { gte: desde } },
        select: { id: true, cuando: true, camara: true, cara: true, cuadro: true },
        orderBy: { cuando: "desc" }, take: MAX,
    }).catch(() => []);
    if (!pasadas.length) return null;

    /* La franja 7 × 24 en la hora del barrio: [0] es lunes, como la espera el panel. */
    const franja: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const enMontevideo = (d: Date) => new Date(d.toLocaleString("en-US", { timeZone: "America/Montevideo" }));
    const dias = new Set<string>();
    for (const p of pasadas) {
        const l = enMontevideo(p.cuando);
        franja[(l.getDay() + 6) % 7][l.getHours()]++;
        dias.add(l.toDateString());
    }

    const orden = [...pasadas].sort((a, b) => a.cuando.getTime() - b.cuando.getTime());
    return {
        dias: DIAS,
        pasos: pasadas.map((p) => ({
            id: p.id,
            momento: p.cuando.toISOString(),
            camara: p.camara || null,
            /* Sin dirección ni decisión a propósito: una cara frente a una cámara no entró ni
               salió, sólo pasó. El panel no dibuja lo que no viene. */
            direccion: null,
            decision: null,
            foto: p.cara || p.cuadro || null,
        })),
        franja,
        perfil: {
            clase: "rostro",
            diasVistos: dias.size,
            entradas: 0,
            salidas: 0,
            primeraVez: orden[0].cuando.toISOString(),
            ultimaVez: orden[orden.length - 1].cuando.toISOString(),
            permanenciaMedianaMin: null,
            permanenciaP90Min: null,
            estimado: true,
        },
    };
}
