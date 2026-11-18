"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { CARA_MIN_FRAC, CARA_MIN_RANGO, caraMinDe, claveCaraMin } from "@/lib/caras-vivo";

/**
 * La distancia de captura de un portero facial, guardada como el ALTO MÍNIMO de cara que el
 * motor necesita para poder comparar, en fracción del alto del cuadro.
 *
 * Por qué una fracción y no píxeles: el mismo portero se mira en un cuadro de 960 px de ancho en
 * el vivo y en uno de 1920 en el stream principal. Un número en píxeles significa una cosa
 * distinta en cada uno; una fracción del alto significa siempre lo mismo y es lo que se puede
 * dibujar encima del video.
 *
 * Es un Setting por equipo y no una columna nueva: es un número por portero y no vale una
 * migración de la base.
 */

export async function leerCaraMin(deviceId: string): Promise<number> {
    const v = await prisma.setting.findUnique({ where: { key: claveCaraMin(deviceId) } }).catch(() => null);
    return caraMinDe(v?.value);
}

export async function guardarCaraMin(deviceId: string, frac: number): Promise<{ ok: boolean; valor: number; error?: string }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    if (!s || !permisosDeSesion(s).includes("dispositivos.editar")) return { ok: false, valor: CARA_MIN_FRAC, error: "Tu rol no puede cambiar los equipos." };
    const d = await prisma.device.findUnique({ where: { id: deviceId }, select: { id: true, name: true } });
    if (!d) return { ok: false, valor: CARA_MIN_FRAC, error: "Ese equipo no existe." };

    const valor = Math.min(CARA_MIN_RANGO.max, Math.max(CARA_MIN_RANGO.min, Number(frac) || CARA_MIN_FRAC));
    const texto = valor.toFixed(3);
    await prisma.setting.upsert({ where: { key: claveCaraMin(d.id) }, update: { value: texto }, create: { key: claveCaraMin(d.id), value: texto } });
    await prisma.accionSistema.create({
        data: { quien: String(s?.name || s?.sub || "panel"), accion: "portero.distancia-captura", objetivo: d.id, ok: true, detalle: `${d.name} · cara mínima ${Math.round(valor * 100)} % del alto` },
    }).catch(() => { });
    return { ok: true, valor };
}
