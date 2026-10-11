"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { getNvrChannels } from "@/app/actions/nvr";
import { getChannelMap } from "@/lib/nvr-resolve";
import { ubicacionDe, leerRetenciones, calcularRetencion as calcular, buscarEnNvrs, type Ubicacion, type Retencion } from "@/lib/grabaciones";

export type FilaGrabacion = { deviceId: string; ip: string; ubicacion: Ubicacion | null; retencion: Retencion | null };

async function conSesion() { if (!(await getSession())) throw new Error("Hace falta una sesión del panel."); }

/** NVR, canal y ultima retencion calculada de cada camara LPR. */
export async function grabacionesLpr(): Promise<Record<string, FilaGrabacion>> {
    await conSesion();
    const cams = await prisma.device.findMany({ where: { deviceType: "LPR_CAMERA" }, select: { id: true, ip: true } });
    const ret = await leerRetenciones();
    const out: Record<string, FilaGrabacion> = {};
    for (const c of cams) out[c.id] = { deviceId: c.id, ip: c.ip, ubicacion: c.ip ? await ubicacionDe(c.ip) : null, retencion: ret[c.ip] || null };
    return out;
}

/**
 * NVR, canal y retención de las cámaras de los tipos pedidos (LPR, intrusión), leyendo el mapa
 * de canales y los nombres de NVR UNA sola vez (con 100+ cámaras de intrusión, por cámara eran
 * 200 consultas).
 */
export async function grabacionesDe(tipos: string[] = ["LPR_CAMERA", "CAMERA"]): Promise<Record<string, FilaGrabacion>> {
    await conSesion();
    const [cams, mapa, ret, nvrs] = await Promise.all([
        prisma.device.findMany({ where: { deviceType: { in: tipos as any } }, select: { id: true, ip: true } }),
        getChannelMap(), leerRetenciones(),
        prisma.device.findMany({ where: { deviceType: "NVR" as any }, select: { id: true, name: true } }),
    ]);
    const nombre = new Map(nvrs.map((n) => [n.id, n.name]));
    const porDefecto = (await prisma.setting.findUnique({ where: { key: "NVR_HOST" } }))?.value || null;
    const nvrDefecto = porDefecto ? (await prisma.device.findFirst({ where: { deviceType: "NVR" as any, ip: porDefecto }, select: { id: true } }))?.id || null : null;
    const out: Record<string, FilaGrabacion> = {};
    for (const c of cams) {
        const e = c.ip ? mapa[c.ip] : null;
        const nvrId = e ? (e.nvrId || nvrDefecto) : null;
        out[c.id] = { deviceId: c.id, ip: c.ip, ubicacion: e ? { nvrId, nvrNombre: (nvrId && nombre.get(nvrId)) || null, ch: e.ch } : null, retencion: ret[c.ip] || null };
    }
    return out;
}

/**
 * Busca en TODOS los NVR donde graba cada camara (por su IP en los canales) y guarda lo hallado
 * en el mapa de canales. No borra nada: una camara que no aparece conserva lo que tenia.
 */
export async function detectarGrabaciones(deviceIds?: string[]): Promise<{ ok: boolean; error?: string; halladas: number; sinNvr: string[]; cambios: string[]; nvrs: { nombre: string; ok: boolean; error?: string; canales: number }[] }> {
    try {
        await conSesion();
        const cams = await prisma.device.findMany({ where: deviceIds?.length ? { id: { in: deviceIds } } : { deviceType: "LPR_CAMERA" }, select: { id: true, ip: true, name: true } });
        const { halladas, nvrs } = await buscarEnNvrs(cams.map((c) => c.ip), getNvrChannels as any);
        const mapa = await getChannelMap();
        const nuevo: Record<string, { nvr: string | null; ch: number }> = {};
        for (const k of Object.keys(mapa)) nuevo[k] = { nvr: mapa[k].nvrId, ch: mapa[k].ch };
        const cambios: string[] = [];
        for (const c of cams) {
            const h = halladas[c.ip]; if (!h) continue;
            const antes = mapa[c.ip];
            if (!antes || antes.ch !== h.ch || (antes.nvrId || null) !== h.nvrId) cambios.push(`${c.name}: ${h.nvrNombre} canal ${h.ch}`);
            nuevo[c.ip] = { nvr: h.nvrId, ch: h.ch };
        }
        if (cambios.length) await prisma.setting.upsert({ where: { key: "NVR_CHANNEL_MAP" }, update: { value: JSON.stringify(nuevo) }, create: { key: "NVR_CHANNEL_MAP", value: JSON.stringify(nuevo) } });
        return { ok: true, halladas: Object.keys(halladas).length, sinNvr: cams.filter((c) => !halladas[c.ip]).map((c) => c.name), cambios, nvrs: nvrs.map(({ nombre, ok, error, canales }) => ({ nombre, ok, error, canales })) };
    } catch (e: any) { return { ok: false, error: e?.message || "No se pudo detectar", halladas: 0, sinNvr: [], cambios: [], nvrs: [] }; }
}

/** Busca donde graba UNA camara (por IP), sin guardar: lo usa el alta antes de crearla. */
export async function dondeGraba(ip: string): Promise<{ ok: boolean; ubicacion: Ubicacion | null; nvrs: { nombre: string; ok: boolean; error?: string; canales: number }[]; hayNvr: boolean }> {
    await conSesion();
    const { halladas, nvrs } = await buscarEnNvrs([ip.trim()], getNvrChannels as any);
    return { ok: true, ubicacion: halladas[ip.trim()] || null, nvrs: nvrs.map(({ nombre, ok, error, canales }) => ({ nombre, ok, error, canales })), hayNvr: nvrs.length > 0 };
}

/** Guarda en el mapa el NVR/canal de una camara (lo usa el alta al terminar). */
export async function asignarGrabacion(ip: string, nvrId: string, ch: number): Promise<{ ok: boolean }> {
    await conSesion();
    const mapa = await getChannelMap();
    const nuevo: Record<string, { nvr: string | null; ch: number }> = {};
    for (const k of Object.keys(mapa)) nuevo[k] = { nvr: mapa[k].nvrId, ch: mapa[k].ch };
    nuevo[ip.trim()] = { nvr: nvrId, ch: Number(ch) };
    await prisma.setting.upsert({ where: { key: "NVR_CHANNEL_MAP" }, update: { value: JSON.stringify(nuevo) }, create: { key: "NVR_CHANNEL_MAP", value: JSON.stringify(nuevo) } });
    return { ok: true };
}

export async function calcularRetencion(deviceId: string): Promise<{ ok: boolean; retencion?: Retencion; error?: string }> {
    try {
        await conSesion();
        const d = await prisma.device.findUnique({ where: { id: deviceId }, select: { ip: true } });
        if (!d?.ip) return { ok: false, error: "Cámara sin IP" };
        return { ok: true, retencion: await calcular(d.ip) };
    } catch (e: any) { return { ok: false, error: e?.message || "No se pudo calcular" }; }
}
