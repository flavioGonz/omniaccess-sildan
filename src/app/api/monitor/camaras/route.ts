export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor, SIN_CACHE } from "@/lib/monitor/servidor";
import { getNvrChannels, type CanalNvr } from "@/app/actions/nvr";
import { registrarCanalNvr } from "@/lib/go2rtc-sync";

/**
 * GET /api/monitor/camaras → los canales que dibuja la pared de video (vista Cámaras).
 *
 * Un canal por cada entrada de cada NVR, más las cámaras que son equipo y no cuelgan de
 * ningún NVR. Si una cámara es equipo Y canal de un NVR (misma IP), va una sola vez, con el
 * stream del equipo: ese suele ir directo a la cámara y no le suma carga al grabador.
 *
 * No dice qué códec usar: eso lo decide cada navegador (ver VistaCamaras). Acá sólo se
 * asegura de que el stream exista en go2rtc — los de canales de NVR viven en su memoria y se
 * pierden si go2rtc reinicia (registrarCanalNvr).
 */

const GO2RTC = process.env.GO2RTC_API || "http://127.0.0.1:1984";
/**
 * Los canales de un NVR se leen por ISAPI y tardan hasta un par de segundos por grabador. La
 * pared pide esto cada 30 s y puede haber varias pantallas: sin esto, cada pantalla le pegaba
 * al NVR en cada vuelta. Un canal que se cae se ve igual en el video, que no pasa por acá.
 */
const CANALES_VIGENTES_MS = 60_000;
/** Cuánto dura roja una baldosa después de la última detección de su cámara. */
const VENTANA_ALERTA_MS = 2 * 60_000;
/**
 * Lo que server.js escribe como etiqueta cuando el NVR avisa de un canal que no está en el mapa
 * de canales: la detección queda sobre el NVR, y esta es la única pista de qué canal fue.
 */
const ETIQUETA_CANAL_SIN_MAPEAR = /^canal (\d+) sin mapear$/;

const canalesCache = new Map<string, { t: number; r: { ok: boolean; error?: string; channels: CanalNvr[] } }>();

async function canalesDe(nvr: { id: string; ip: string; username: string | null; password: string | null; authType: string | null }) {
    const c = canalesCache.get(nvr.id);
    if (c && Date.now() - c.t < CANALES_VIGENTES_MS) return c.r;
    const r = await getNvrChannels({ ip: nvr.ip, username: nvr.username || undefined, password: nvr.password || undefined, authType: nvr.authType || undefined })
        .catch((e: any) => ({ ok: false, error: e?.message || "sin respuesta", channels: [] as CanalNvr[] }));
    const norm = { ok: !!(r as any).ok, error: (r as any).error, channels: ((r as any).channels || []) as CanalNvr[] };
    // Un error no se guarda: la próxima vuelta se vuelve a intentar.
    if (norm.ok) canalesCache.set(nvr.id, { t: Date.now(), r: norm });
    return norm;
}

async function streamsEnGo2rtc(): Promise<Set<string> | null> {
    try {
        const c = new AbortController(); const t = setTimeout(() => c.abort(), 4000);
        const r = await fetch(`${GO2RTC}/api/streams`, { cache: "no-store", signal: c.signal });
        clearTimeout(t);
        if (!r.ok) return null;
        return new Set(Object.keys(await r.json()));
    } catch { return null; }
}

export type CanalPared = {
    clave: string;
    nombre: string;
    nvrId: string | null;
    nvr: string | null;
    ch: number | null;
    /** null = el grabador no dice; las cámaras sueltas no tienen quién lo diga. */
    online: boolean | null;
    /** Nombre del stream en go2rtc; el HD es `${stream}_hd`. */
    stream: string;
    /** Si es un equipo de OmniAccess: sus detecciones llegan con este id. */
    equipoId: string | null;
    alerta: { id: string; tipo: string; ts: string } | null;
};

export async function GET() {
    const p = await autorizarMonitor("/api/monitor/camaras");
    if (p.error) return p.error;

    const [nvrs, equipos, streams, recientes] = await Promise.all([
        prisma.device.findMany({ where: { deviceType: "NVR" as any }, select: { id: true, name: true, ip: true, username: true, password: true, authType: true }, orderBy: { name: "asc" } }),
        prisma.device.findMany({ where: { deviceType: { not: "NVR" as any } }, select: { id: true, name: true, ip: true }, orderBy: { name: "asc" } }),
        streamsEnGo2rtc(),
        prisma.detection.findMany({
            where: { timestamp: { gte: new Date(Date.now() - VENTANA_ALERTA_MS) }, type: { not: "MOTION" } },
            select: { id: true, deviceId: true, type: true, label: true, timestamp: true }, orderBy: { timestamp: "desc" }, take: 300,
        }).catch(() => []),
    ]);

    // La última detección de cada cámara, y la de cada canal sin mapear de cada NVR.
    const alertaPorEquipo = new Map<string, CanalPared["alerta"]>();
    const alertaPorCanal = new Map<string, CanalPared["alerta"]>();
    for (const d of recientes) {
        if (!d.deviceId) continue;
        const a = { id: d.id, tipo: String(d.type), ts: d.timestamp.toISOString() };
        const m = d.label ? ETIQUETA_CANAL_SIN_MAPEAR.exec(d.label) : null;
        if (m) { const k = `${d.deviceId}:${m[1]}`; if (!alertaPorCanal.has(k)) alertaPorCanal.set(k, a); }
        else if (!alertaPorEquipo.has(d.deviceId)) alertaPorEquipo.set(d.deviceId, a);
    }

    const porIp = new Map(equipos.filter((e) => e.ip).map((e) => [e.ip as string, e]));
    const usados = new Set<string>();
    const canales: CanalPared[] = [];
    const errores: { nvr: string; error: string }[] = [];
    const porRegistrar: { nvrId: string; ch: number }[] = [];

    const lecturas = await Promise.all(nvrs.map((n) => canalesDe(n as any).then((r) => ({ n, r }))));
    for (const { n, r } of lecturas) {
        if (!r.ok) { errores.push({ nvr: n.name, error: r.error || "No se pudieron leer los canales" }); continue; }
        for (const c of [...r.channels].sort((a, b) => a.channel - b.channel)) {
            // El segundo sensor de una cámara bi-espectral es la misma cámara: va una vez.
            if (c.sensorDe) continue;
            const ch = Number(c.channel);
            const eq = c.ip ? porIp.get(c.ip) : undefined;
            if (eq && streams?.has(`lpr_${eq.id}`)) {
                usados.add(eq.id);
                canales.push({ clave: `dev:${eq.id}`, nombre: eq.name, nvrId: n.id, nvr: n.name, ch, online: c.online ?? null, stream: `lpr_${eq.id}`, equipoId: eq.id, alerta: alertaPorEquipo.get(eq.id) || alertaPorCanal.get(`${n.id}:${ch}`) || null });
                continue;
            }
            const stream = `lpr_nvrch-${n.id}-${ch}`;
            if (!streams?.has(stream) || !streams?.has(`${stream}_hd`)) porRegistrar.push({ nvrId: n.id, ch });
            canales.push({ clave: `nvr:${n.id}:${ch}`, nombre: c.name || `Canal ${ch}`, nvrId: n.id, nvr: n.name, ch, online: c.online ?? null, stream, equipoId: null, alerta: alertaPorCanal.get(`${n.id}:${ch}`) || null });
        }
    }
    // Las cámaras que son equipo y no aparecieron en ningún NVR: las que tienen vivo en go2rtc.
    for (const e of equipos) {
        if (usados.has(e.id) || !streams?.has(`lpr_${e.id}`)) continue;
        canales.push({ clave: `dev:${e.id}`, nombre: e.name, nvrId: null, nvr: null, ch: null, online: null, stream: `lpr_${e.id}`, equipoId: e.id, alerta: alertaPorEquipo.get(e.id) || null });
    }
    // Registrar en go2rtc es sólo dejar la receta: no abre ninguna conexión hasta que alguien mira.
    if (streams) await Promise.all(porRegistrar.map((x) => registrarCanalNvr(x.nvrId, x.ch).catch(() => null)));

    return NextResponse.json({
        canales,
        errores,
        go2rtc: !!streams,
        ventanaAlertaMs: VENTANA_ALERTA_MS,
        ahora: new Date().toISOString(),
    }, { headers: SIN_CACHE });
}
