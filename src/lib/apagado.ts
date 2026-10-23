import { prisma } from "@/lib/prisma";
import { esLprDeAcceso } from "@/lib/modo-camara";

/**
 * Apagar un área (o «Sin área», o un tipo de equipo) entera: que OmniAccess deje de consumir esas
 * cámaras sin borrarlas (21/10, Nico: «un mini toggle para apagar todos los dispositivos de esa
 * área, y que OmniAccess no consuma esas cámaras; un apagado de área que se pueda reactivar»).
 *
 * Lo que se apaga se guarda junto a las áreas (DEVICE_AREAS.apagadas: ids de área, SIN_AREA o
 * «tipo:<vista>»). De ahí sale la lista de equipos apagados, que se escribe aparte en
 * EQUIPOS_APAGADOS para que la lean los workers sin saber de áreas. Un equipo está apagado si su
 * área o alguna de arriba está apagada, si no tiene área y «Sin área» lo está, o si su tipo lo está.
 *
 * Qué deja de hacer OmniAccess con un equipo apagado: su vivo (go2rtc: se quitan sus streams),
 * el análisis de OmniVision, la lectura de omni-lpr, la consulta de salud y el sondeo de eventos.
 * No se toca nada en la cámara ni en el NVR, ni la configuración guardada: al reactivar, todo vuelve.
 */
export const CLAVE_APAGADOS = "EQUIPOS_APAGADOS";
export const APAGADO_SIN_AREA = "__sin_area";
export const apagadoTipo = (vista: string) => `tipo:${vista}`;

type EstadoMin = { areas: { id: string; padre: string | null }[]; equipos: Record<string, string>; apagadas?: string[] };
type EquipoMin = { id: string; deviceType: string; trackAcceso?: boolean | null };

/** La vista de un equipo en la pantalla de Dispositivos (la lectura OmniVision va con las LPR). */
export const vistaDeEquipo = (d: EquipoMin) => (esLprDeAcceso(d as any) ? "LPR_CAMERA" : String(d.deviceType));

export function idsApagados(estado: EstadoMin, equipos: EquipoMin[]): Set<string> {
    const ap = new Set(estado.apagadas || []);
    const out = new Set<string>();
    if (!ap.size) return out;
    const padre = new Map(estado.areas.map((a) => [a.id, a.padre]));
    const areaApagada = (id: string | undefined) => {
        let cur: string | null | undefined = id;
        for (let i = 0; cur && i < 100; i++) { if (ap.has(cur)) return true; cur = padre.get(cur); }
        return false;
    };
    for (const d of equipos) {
        const area = estado.equipos[d.id];
        const enArea = area && padre.has(area) ? area : undefined;
        if ((enArea ? areaApagada(enArea) : ap.has(APAGADO_SIN_AREA)) || ap.has(apagadoTipo(vistaDeEquipo(d)))) out.add(d.id);
    }
    return out;
}

const VIGENCIA_MS = 10_000;
let cache: { t: number; ids: Set<string> } | null = null;

/** Los equipos apagados (cacheado unos segundos: lo consultan la salud y el sondeo a cada vuelta). */
export async function equiposApagados(): Promise<Set<string>> {
    if (cache && Date.now() - cache.t < VIGENCIA_MS) return cache.ids;
    let ids = new Set<string>();
    try { const v = (await prisma.setting.findUnique({ where: { key: CLAVE_APAGADOS } }))?.value; ids = new Set(JSON.parse(v || "[]").map(String)); } catch { }
    cache = { t: Date.now(), ids };
    return ids;
}

/**
 * Lo apagado visto desde los canales de los NVR (22/10, Nico: «desactivé un área con dispositivos y
 * los sigo viendo en el Monitor CCTV»). Un equipo apagado perdía su stream propio, pero la pared lo
 * seguía mostrando como CANAL DEL NVR (lpr_nvrch-…), que se registraba solo. Un canal está apagado si
 * su NVR lo está, o si la cámara que graba (por IP, o por el mapa de canales) es un equipo apagado.
 */
export async function lectorCanalesApagados(): Promise<{ equipos: Set<string>; ips: Set<string>; canales: Set<string>; apagado: (nvrId: string | null | undefined, ch?: number | null, ip?: string | null) => boolean }> {
    const equipos = await equiposApagados();
    const ips = new Set<string>();
    const canales = new Set<string>();
    if (equipos.size) {
        const devs = await prisma.device.findMany({ where: { id: { in: [...equipos] } }, select: { ip: true } }).catch(() => []);
        for (const d of devs) if (d.ip) ips.add(d.ip);
        try {
            const { getChannelMap } = await import("@/lib/nvr-resolve");
            const mapa = await getChannelMap();
            for (const ip of ips) { const m = mapa[ip]; if (m?.nvrId && m.ch) canales.add(`${m.nvrId}:${m.ch}`); }
        } catch { }
    }
    const apagado = (nvrId: string | null | undefined, ch?: number | null, ip?: string | null) =>
        (!!nvrId && equipos.has(nvrId)) || (!!ip && ips.has(ip)) || (!!nvrId && ch != null && canales.has(`${nvrId}:${ch}`));
    return { equipos, ips, canales, apagado };
}

/**
 * Recalcula la lista de apagados desde las áreas y aplica la diferencia: a los que se apagan se les
 * quitan los streams; a los que vuelven se les registran de nuevo. Devuelve cuántos quedaron apagados.
 */
export async function recalcularApagados(estado: EstadoMin): Promise<{ apagados: number; apagadosAhora: string[]; prendidosAhora: string[] }> {
    const equipos = await prisma.device.findMany({ select: { id: true, deviceType: true, trackAcceso: true } });
    const nuevos = idsApagados(estado, equipos as any);
    let antes = new Set<string>();
    try { const v = (await prisma.setting.findUnique({ where: { key: CLAVE_APAGADOS } }))?.value; antes = new Set(JSON.parse(v || "[]").map(String)); } catch { }
    const value = JSON.stringify([...nuevos]);
    await prisma.setting.upsert({ where: { key: CLAVE_APAGADOS }, update: { value }, create: { key: CLAVE_APAGADOS, value } });
    cache = { t: Date.now(), ids: nuevos };
    const apagadosAhora = [...nuevos].filter((x) => !antes.has(x));
    const prendidosAhora = [...antes].filter((x) => !nuevos.has(x));
    try {
        const { quitarStreams, syncLprStream } = await import("@/lib/go2rtc-sync");
        if (apagadosAhora.length) {
            // También los canales de NVR que muestran a esas cámaras (o todos los de un NVR apagado):
            // los registra la pared al mirarlos y, si no, seguían en go2rtc.
            const extra: string[] = [];
            try {
                const { getChannelMap } = await import("@/lib/nvr-resolve");
                const [mapa, devs, lista] = await Promise.all([
                    getChannelMap(),
                    prisma.device.findMany({ where: { id: { in: apagadosAhora } }, select: { id: true, ip: true, deviceType: true } }),
                    fetch(`${process.env.GO2RTC_API || "http://127.0.0.1:1984"}/api/streams`, { cache: "no-store", signal: AbortSignal.timeout(4000) }).then((r) => r.json()).catch(() => ({})),
                ]);
                const nombres = Object.keys(lista || {});
                for (const d of devs) {
                    if (d.deviceType === "NVR") extra.push(...nombres.filter((n) => n.startsWith(`lpr_nvrch-${d.id}-`)));
                    const m = d.ip ? mapa[d.ip] : undefined;
                    if (m?.nvrId && m.ch) extra.push(`lpr_nvrch-${m.nvrId}-${m.ch}`, `lpr_nvrch-${m.nvrId}-${m.ch}_hd`);
                }
            } catch { }
            await quitarStreams([...new Set([...apagadosAhora.flatMap((x) => [`lpr_${x}`, `lpr_${x}_hd`]), ...extra])]);
        }
        if (prendidosAhora.length) {
            const devs = await prisma.device.findMany({ where: { id: { in: prendidosAhora } } });
            for (const d of devs) await syncLprStream(d as any).catch(() => { });
        }
    } catch (e) { console.error("[apagado] go2rtc:", (e as any)?.message); }
    return { apagados: nuevos.size, apagadosAhora, prendidosAhora };
}
