import { prisma } from "@/lib/prisma";
import { getChannelMap } from "@/lib/nvr-resolve";

/**
 * Las cámaras de la video verificación de un evento de central, listas para la pantalla
 * (openspec alarmas-como-funciones, «verificacion-video-alarmas»). La decisión de cuáles (zona →
 * área → abonado) vive en lib-centrales-camaras.js, compartida con alarm-receiver; acá se le pone
 * a cada una su nombre, su stream y si tiene grabador para «Ver el momento».
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cc = require("../../../lib-centrales-camaras.js") as {
    TOPE: number;
    canalDe: (id: string) => { nvrId: string; ch: number } | null;
    streamDe: (id: string) => string;
    elegir: (p: { zona?: string[]; area?: string[]; abonado?: string[]; areaNombre?: string | null; tope?: number }) => Resultado;
    camarasDeZona: (p: typeof prisma, centralId: string, zona: number | null) => Promise<Resultado & { abonado: string[] }>;
};

export type OrigenCamaras = "zona" | "area" | "abonado" | "ninguna";
type Resultado = { ids: string[]; origen: OrigenCamaras; area: string | null };

export type CamRef = {
    /** Id de equipo, o `nvrch-<nvr>-<ch>` para un canal de NVR que no es equipo. */
    id: string;
    nombre: string;
    /** El stream de go2rtc para el vivo (`lpr_<id>`). */
    stream: string;
    /** Para «Ver el momento»: el equipo, o el NVR y el canal donde graba. Sin `nvrId`, no hay grabador conocido. */
    deviceId: string | null;
    nvrId: string | null;
    ch: number | null;
    grabador: boolean;
};

export const canalDe = cc.canalDe;
export const elegirCamaras = cc.elegir;

/** Nombre, stream y grabador de cada cámara, en el mismo orden. Las que ya no existen se descartan. */
export async function describirCamaras(ids: string[]): Promise<CamRef[]> {
    if (!ids.length) return [];
    const canales = ids.map((id) => ({ id, c: cc.canalDe(id) }));
    const devIds = canales.filter((x) => !x.c).map((x) => x.id);
    const nvrIds = [...new Set(canales.map((x) => x.c?.nvrId).filter(Boolean))] as string[];
    const [devs, nvrs, mapa] = await Promise.all([
        devIds.length ? prisma.device.findMany({ where: { id: { in: devIds } }, select: { id: true, name: true, ip: true } }) : Promise.resolve([]),
        nvrIds.length ? prisma.device.findMany({ where: { id: { in: nvrIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
        devIds.length ? getChannelMap().catch(() => ({} as Record<string, { nvrId: string | null; ch: number }>)) : Promise.resolve({} as Record<string, { nvrId: string | null; ch: number }>),
    ]);
    const dev = new Map(devs.map((d) => [d.id, d]));
    const nvr = new Map(nvrs.map((n) => [n.id, n.name]));
    const out: CamRef[] = [];
    for (const { id, c } of canales) {
        if (c) {
            if (!nvr.has(c.nvrId)) continue;
            out.push({ id, nombre: `${nvr.get(c.nvrId)} · canal ${c.ch}`, stream: cc.streamDe(id), deviceId: null, nvrId: c.nvrId, ch: c.ch, grabador: true });
            continue;
        }
        const d = dev.get(id);
        if (!d) continue;
        const m = d.ip ? mapa[d.ip] : undefined;
        out.push({ id, nombre: d.name, stream: cc.streamDe(id), deviceId: id, nvrId: m?.nvrId || null, ch: m?.ch ?? null, grabador: !!m?.nvrId });
    }
    return out;
}

/** Que go2rtc tenga la receta de los canales de NVR (sólo deja la receta: no abre nada hasta que alguien mira). */
async function registrarCanales(camaras: CamRef[]) {
    const canales = camaras.filter((c) => c.deviceId === null && c.nvrId && c.ch);
    if (!canales.length) return;
    const { registrarCanalNvr } = await import("@/lib/go2rtc-sync");
    await Promise.all(canales.map((c) => registrarCanalNvr(c.nvrId!, c.ch!).catch(() => null)));
}

export type CamarasEvento = { camaras: CamRef[]; origen: OrigenCamaras; area: string | null; otras: CamRef[] };

/** Las cámaras de un evento: las de la verificación y las demás del abonado («otras»). */
export async function camarasDeEvento(centralId: string | null | undefined, zona: number | null | undefined): Promise<CamarasEvento> {
    if (!centralId) return { camaras: [], origen: "ninguna", area: null, otras: [] };
    const r = await cc.camarasDeZona(prisma, centralId, zona ?? null);
    const usadas = new Set(r.ids);
    const [camaras, otras] = await Promise.all([describirCamaras(r.ids), describirCamaras(r.abonado.filter((id) => !usadas.has(id)))]);
    await registrarCanales([...camaras, ...otras]).catch(() => { });
    return { camaras, origen: r.origen, area: r.area, otras };
}

/** Para el editor de zonas: de dónde sale cada zona (sin describir cámaras: sólo cuántas y de qué lista). */
export async function origenesDeZonas(centralId: string): Promise<Record<number, { origen: OrigenCamaras; area: string | null; n: number }>> {
    const zonas = await prisma.zonaCentral.findMany({ where: { centralId }, select: { zona: true } });
    const out: Record<number, { origen: OrigenCamaras; area: string | null; n: number }> = {};
    for (const z of zonas) {
        const r = await cc.camarasDeZona(prisma, centralId, z.zona);
        out[z.zona] = { origen: r.origen, area: r.area, n: r.ids.length };
    }
    return out;
}
