import { prisma } from "@/lib/prisma";

/**
 * «Lo atiendo» y «Silenciar» desde Telegram (HB, 20/10: «botones de consultas, explotar al máximo
 * Telegram»). Viven en ajustes y no en una tabla: son pocos y cambian poco (un acuse por fila y
 * episodio, un silencio a la vez), y así no hace falta migrar la base para tenerlos.
 *
 *   · Acuse: quién dijo «lo atiendo» y cuándo, por fila. Corta el escalamiento al supervisor de
 *     ESE episodio (lo mira onvif-polling) y deja el tiempo de reacción registrado.
 *   · Silencio: hasta cuándo no salen avisos de fila llena (el panel y la pantalla siguen igual).
 */

const CLAVE_ACUSE = (deviceId: string) => `FILAS_ACUSE_${deviceId}`;
const CLAVE_SILENCIO = "FILAS_SILENCIO_HASTA";
/** Registro de los últimos acuses, para el tiempo de reacción. */
const CLAVE_HISTORIAL = "FILAS_ACUSES_HISTORIAL";
const HISTORIAL_MAX = 200;

export type Acuse = { quien: string; t: string; avisoT?: string | null; reaccionSeg?: number | null };

async function guardar(key: string, value: string) {
    await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export async function registrarAcuse(deviceId: string, quien: string, avisoT?: Date | null): Promise<Acuse> {
    const ahora = new Date();
    const a: Acuse = { quien, t: ahora.toISOString(), avisoT: avisoT?.toISOString() || null, reaccionSeg: avisoT ? Math.max(0, Math.round((ahora.getTime() - avisoT.getTime()) / 1000)) : null };
    await guardar(CLAVE_ACUSE(deviceId), JSON.stringify(a));
    try {
        const h = await prisma.setting.findUnique({ where: { key: CLAVE_HISTORIAL } });
        const lista = h?.value ? JSON.parse(h.value) : [];
        lista.push({ deviceId, ...a });
        await guardar(CLAVE_HISTORIAL, JSON.stringify(lista.slice(-HISTORIAL_MAX)));
    } catch { /* el historial es un extra: el acuse ya quedó */ }
    return a;
}

/** El último acuse de una fila, si es posterior a `desde` (el comienzo del episodio). */
export async function acuseDesde(deviceId: string, desde: Date): Promise<Acuse | null> {
    const s = await prisma.setting.findUnique({ where: { key: CLAVE_ACUSE(deviceId) } }).catch(() => null);
    if (!s?.value) return null;
    try { const a: Acuse = JSON.parse(s.value); return new Date(a.t) >= desde ? a : null; } catch { return null; }
}

export async function silenciar(minutos: number): Promise<Date> {
    const hasta = new Date(Date.now() + minutos * 60_000);
    await guardar(CLAVE_SILENCIO, hasta.toISOString());
    return hasta;
}
export async function reactivar() { await guardar(CLAVE_SILENCIO, ""); }

export async function silencioHasta(): Promise<Date | null> {
    const s = await prisma.setting.findUnique({ where: { key: CLAVE_SILENCIO } }).catch(() => null);
    if (!s?.value) return null;
    const d = new Date(s.value);
    return d.getTime() > Date.now() ? d : null;
}

/** Tiempo de reacción de hoy (acuses con aviso), en segundos: mediana y cantidad. */
export async function reaccionDesde(desde: Date): Promise<{ n: number; medianaSeg: number | null }> {
    const h = await prisma.setting.findUnique({ where: { key: CLAVE_HISTORIAL } }).catch(() => null);
    let lista: (Acuse & { deviceId: string })[] = [];
    try { lista = h?.value ? JSON.parse(h.value) : []; } catch { /* vacío */ }
    const xs = lista.filter((a) => new Date(a.t) >= desde && a.reaccionSeg != null).map((a) => a.reaccionSeg!).sort((a, b) => a - b);
    return { n: xs.length, medianaSeg: xs.length ? xs[Math.floor(xs.length / 2)] : null };
}
