import { prisma } from "@/lib/prisma";

/**
 * El reloj de un grabador, respecto del nuestro.
 *
 * El grabador guarda lo que pasó a las 10:00:00 con SU hora: si atrasa 26 s, eso está en sus
 * 09:59:34, y pedirle las 10:00:00 trae lo que pasó 26 s después. Medido el 14/11 en el lab: un
 * grabador atrasa 24-26 s; los otros, entre 1 y 5.
 *
 * Nació el 14/11 adentro del clip del botón Grabar (lib/clip-instante), que salía corrido. El
 * 15/11 pasó acá porque la reproducción tenía el mismo error y nadie lo había corregido (Nico,
 * sobre «Ver cuándo llegó»: «no se ve la llegada ni el estacionamiento… no sé si son 10 o 20
 * segundos»): la grabación se abría 12 s antes de que el auto quedara quieto, pero con un
 * grabador que atrasa 26 s eso era 14 s DESPUÉS. Lo mismo le pasaba a cualquier «ver la
 * grabación de este instante» de ese grabador.
 */

/** Diferencia que se corrige: menos es ruido; más no es un reloj corrido sino la zona horaria mal puesta. */
export const RELOJ_MIN_SEG = 3, RELOJ_MAX_SEG = 300;
/** Una muestra de salud más vieja que esto no dice cómo está el reloj ahora. */
const MUESTRA_MAX_MS = 3600_000;

/** Los segundos que hay que sumarle a una hora nuestra para pedírsela al grabador (negativo = atrasa). */
export function correccionDeReloj(driftSec: number | null | undefined): number {
    const d = typeof driftSec === "number" && Number.isFinite(driftSec) ? driftSec : 0;
    return Math.abs(d) >= RELOJ_MIN_SEG && Math.abs(d) <= RELOJ_MAX_SEG ? d : 0;
}

/** Lo mismo, para un grabador: según su última muestra de salud. Sin muestra reciente, no se corrige nada. */
export async function relojDelGrabador(nvrId: string | null | undefined): Promise<number> {
    if (!nvrId) return 0;
    const m = await prisma.deviceHealthSample.findFirst({ where: { deviceId: nvrId, driftSec: { not: null }, ts: { gte: new Date(Date.now() - MUESTRA_MAX_MS) } }, orderBy: { ts: "desc" }, select: { driftSec: true } }).catch(() => null);
    return correccionDeReloj(m?.driftSec);
}
