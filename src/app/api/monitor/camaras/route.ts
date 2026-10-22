export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor, SIN_CACHE } from "@/lib/monitor/servidor";
import { getNvrChannels, type CanalNvr } from "@/app/actions/nvr";
import { registrarCanalNvr } from "@/lib/go2rtc-sync";
import { getChannelMap } from "@/lib/nvr-resolve";
import { getAnalyticsGeometryBatch } from "@/app/actions/detections";
import { puedeDisenarVistas } from "@/app/actions/monitores";
import { AJUSTE_VISTAS_CAMARAS, leerVistas } from "@/lib/monitor/disposiciones";
import { verificacionesDe } from "@/lib/verificacion";
import { camarasVision, cargaVision } from "@/lib/vision-camaras";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { leerArbolAreas } from "@/lib/areas-historial";

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
/** Hasta dónde se mira para «la última detección» que muestra una cámara de intrusión en calma. */
const ULTIMA_DETECCION_MS = 24 * 3600_000;
/**
 * Una cámara cuenta como de intrusión o de LPR si trabajó como tal en este tiempo, además de
 * por su tipo: en San Nicolás «MATRICULA SALIDA» está dada de alta como cámara común y lee
 * chapas, y las perimetrales son CAMERA y vigilan una línea.
 */
const ACTIVIDAD_MS = 7 * 24 * 3600_000;
/** Cuántas lecturas recientes muestra una cámara LPR en su baldosa. */
const LECTURAS_POR_CAMARA = 4;
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
    /** El área de Dispositivos (la del equipo; un canal sin equipo toma la de su NVR). Para filtrar la pared. */
    areaId?: string | null;
    /**
     * La detección en curso (de los últimos VENTANA_ALERTA_MS). `foto` es su captura y `verif` lo
     * que OmniVision vio en ella (siluetas y veredicto): la baldosa la muestra un rato con las
     * siluetas encima. Llega sola cuando vision-worker termina de mirarla (socket detection_verified).
     */
    alerta: { id: string; tipo: string; ts: string; foto?: string | null; verif?: { veredicto: string | null; analisis: any } | null } | null;
    /** Qué hace además de filmar: se dibuja encima de su video. */
    funcion: "intrusion" | "lpr" | null;
    /** La línea y la zona configuradas en la cámara (sólo intrusión). */
    geom: { line: { x: number; y: number }[]; field: { x: number; y: number }[] } | null;
    /** La última detección de las últimas 24 h, aunque ya no esté en alerta. */
    ultima: { id: string; tipo: string; ts: string; foto?: string | null } | null;
    lecturas: { id: string; ts: string; plate: string | null; decision: string; sentido: string; listaNegra: boolean }[];
    /** Si OmniVision analiza esta cámara (VISION_CAMARAS) y cuántos análisis por segundo le cuesta, medido. */
    vision?: { analiza: boolean; porSeg: number | null };
};

export async function GET() {
    const p = await autorizarMonitor("/api/monitor/camaras");
    if (p.error) return p.error;

    const desdeActividad = new Date(Date.now() - ACTIVIDAD_MS);
    const [nvrs, equipos, streams, recientes, conDetecciones, conLecturas, filasAjustes, puedeEditar] = await Promise.all([
        prisma.device.findMany({ where: { deviceType: "NVR" as any }, select: { id: true, name: true, ip: true, username: true, password: true, authType: true }, orderBy: { name: "asc" } }),
        prisma.device.findMany({ where: { deviceType: { not: "NVR" as any } }, select: { id: true, name: true, ip: true, deviceType: true }, orderBy: { name: "asc" } }),
        streamsEnGo2rtc(),
        prisma.detection.findMany({
            where: { timestamp: { gte: new Date(Date.now() - ULTIMA_DETECCION_MS) }, type: { not: "MOTION" } },
            select: { id: true, deviceId: true, type: true, label: true, timestamp: true, snapshotPath: true }, orderBy: { timestamp: "desc" }, take: 1000,
        }).catch(() => []),
        prisma.detection.groupBy({ by: ["deviceId"], where: { timestamp: { gte: desdeActividad }, type: { not: "MOTION" } } }).catch(() => []),
        prisma.accessEvent.groupBy({ by: ["deviceId"], where: { timestamp: { gte: desdeActividad } } }).catch(() => []),
        prisma.setting.findMany({ where: { key: { in: [AJUSTE_VISTAS_CAMARAS, "VISUAL_TRACK_LINKS"] } } }).catch(() => []),
        p.auth.pantalla ? Promise.resolve(false) : puedeDisenarVistas(),
    ]);

    // La última detección de cada cámara, y la de cada canal sin mapear de cada NVR.
    const ultimaPorEquipo = new Map<string, NonNullable<CanalPared["ultima"]>>();
    const ultimaPorCanal = new Map<string, NonNullable<CanalPared["ultima"]>>();
    for (const d of recientes) {
        if (!d.deviceId) continue;
        const a = { id: d.id, tipo: String(d.type), ts: d.timestamp.toISOString(), foto: d.snapshotPath || null };
        const m = d.label ? ETIQUETA_CANAL_SIN_MAPEAR.exec(d.label) : null;
        if (m) { const k = `${d.deviceId}:${m[1]}`; if (!ultimaPorCanal.has(k)) ultimaPorCanal.set(k, a); }
        else if (!ultimaPorEquipo.has(d.deviceId)) ultimaPorEquipo.set(d.deviceId, a);
    }
    const vigente = (a: CanalPared["ultima"] | undefined) => (a && Date.now() - +new Date(a.ts) < VENTANA_ALERTA_MS ? a : null);
    const alertaPorEquipo = { get: (id: string) => vigente(ultimaPorEquipo.get(id)) };
    const alertaPorCanal = { get: (k: string) => vigente(ultimaPorCanal.get(k)) };

    // Qué hace cada equipo además de filmar.
    const detecta = new Set(conDetecciones.map((x: any) => x.deviceId).filter(Boolean));
    const lee = new Set([...conLecturas.map((x: any) => x.deviceId).filter(Boolean), ...equipos.filter((e) => String(e.deviceType).startsWith("LPR")).map((e) => e.id)]);
    const candidatosIntrusion = equipos.filter((e) => ["CAMERA", "LPR_INTERIOR"].includes(String(e.deviceType))).map((e) => e.id);
    const geoms: Record<string, any> = await getAnalyticsGeometryBatch(candidatosIntrusion).catch(() => ({}));
    const tieneGeom = (id: string) => { const g = geoms[id]; return !!g && ((g.line?.length || 0) >= 2 || (g.field?.length || 0) >= 3); };
    const funcionDe = (id: string): CanalPared["funcion"] => (lee.has(id) ? "lpr" : detecta.has(id) || tieneGeom(id) ? "intrusion" : null);
    const lecturasPorEquipo = new Map<string, CanalPared["lecturas"]>();
    await Promise.all([...lee].map(async (id) => {
        const filas = await prisma.accessEvent.findMany({ where: { deviceId: id }, orderBy: { timestamp: "desc" }, take: LECTURAS_POR_CAMARA, select: { id: true, timestamp: true, plateDetected: true, decision: true, direction: true, details: true } }).catch(() => []);
        lecturasPorEquipo.set(id, filas.map((f) => ({ id: f.id, ts: f.timestamp.toISOString(), plate: f.plateDetected || null, decision: String(f.decision), sentido: String(f.direction), listaNegra: /lista negra/i.test(f.details || "") })));
    }));
    const extrasDe = (id: string) => {
        const funcion = funcionDe(id);
        const g = funcion === "intrusion" && tieneGeom(id) ? { line: geoms[id].line || [], field: geoms[id].field || [] } : null;
        return { funcion, geom: g, ultima: ultimaPorEquipo.get(id) || null, lecturas: funcion === "lpr" ? lecturasPorEquipo.get(id) || [] : [] };
    };

    const porIp = new Map(equipos.filter((e) => e.ip).map((e) => [e.ip as string, e]));
    // Lo apagado por área (lib/apagado) no va a la pared: ni como equipo ni como canal de su NVR.
    const { lectorCanalesApagados } = await import("@/lib/apagado");
    const off = await lectorCanalesApagados().catch(() => null);
    const usados = new Set<string>();
    const canales: CanalPared[] = [];
    const errores: { nvr: string; error: string }[] = [];
    const porRegistrar: { nvrId: string; ch: number }[] = [];

    const lecturas = await Promise.all(nvrs.map((n) => canalesDe(n as any).then((r) => ({ n, r }))));
    for (const { n, r } of lecturas) {
        if (off?.equipos.has(n.id)) continue;
        if (!r.ok) { errores.push({ nvr: n.name, error: r.error || "No se pudieron leer los canales" }); continue; }
        for (const c of [...r.channels].sort((a, b) => a.channel - b.channel)) {
            // El segundo sensor de una cámara bi-espectral es la misma cámara: va una vez.
            if (c.sensorDe) continue;
            const ch = Number(c.channel);
            const eq = c.ip ? porIp.get(c.ip) : undefined;
            if (off?.apagado(n.id, ch, c.ip || null) || (eq && off?.equipos.has(eq.id))) { if (eq) usados.add(eq.id); continue; }
            if (eq && streams?.has(`lpr_${eq.id}`)) {
                usados.add(eq.id);
                canales.push({ clave: `dev:${eq.id}`, nombre: eq.name, nvrId: n.id, nvr: n.name, ch, online: c.online ?? null, stream: `lpr_${eq.id}`, equipoId: eq.id, alerta: alertaPorEquipo.get(eq.id) || alertaPorCanal.get(`${n.id}:${ch}`) || null, ...extrasDe(eq.id) });
                continue;
            }
            const stream = `lpr_nvrch-${n.id}-${ch}`;
            if (!streams?.has(stream) || !streams?.has(`${stream}_hd`)) porRegistrar.push({ nvrId: n.id, ch });
            canales.push({ clave: `nvr:${n.id}:${ch}`, nombre: c.name || `Canal ${ch}`, nvrId: n.id, nvr: n.name, ch, online: c.online ?? null, stream, equipoId: null, alerta: alertaPorCanal.get(`${n.id}:${ch}`) || null,
                funcion: ultimaPorCanal.has(`${n.id}:${ch}`) ? "intrusion" : null, geom: null, ultima: ultimaPorCanal.get(`${n.id}:${ch}`) || null, lecturas: [] });
        }
    }
    // Las cámaras que son equipo y no aparecieron en ningún NVR: las que tienen vivo en go2rtc.
    // Si están en el mapa de canales (NVR_CHANNEL_MAP), se sabe en qué NVR graban: es lo que
    // necesita la grabación sobre el vivo. Pasa, por ejemplo, con las del NVR que no contesta.
    const mapa = await getChannelMap().catch(() => ({} as Record<string, { nvrId: string | null; ch: number }>));
    const nombreNvr = new Map(nvrs.map((n) => [n.id, n.name]));
    for (const e of equipos) {
        if (usados.has(e.id) || off?.equipos.has(e.id) || !streams?.has(`lpr_${e.id}`)) continue;
        const m = e.ip ? mapa[e.ip] : undefined;
        const nvrId = m?.nvrId && nombreNvr.has(m.nvrId) ? m.nvrId : null;
        canales.push({ clave: `dev:${e.id}`, nombre: e.name, nvrId, nvr: nvrId ? nombreNvr.get(nvrId)! : null, ch: nvrId && m ? m.ch : null, online: null, stream: `lpr_${e.id}`, equipoId: e.id, alerta: alertaPorEquipo.get(e.id) || null, ...extrasDe(e.id) });
    }
    // Registrar en go2rtc es sólo dejar la receta: no abre ninguna conexión hasta que alguien mira.
    if (streams) await Promise.all(porRegistrar.map((x) => registrarCanalNvr(x.nvrId, x.ch).catch(() => null)));

    // Lo que vio OmniVision en las capturas de las detecciones en curso (pocas: las de 2 minutos).
    const enCurso = canales.map((c) => c.alerta?.id).filter(Boolean) as string[];
    if (enCurso.length) {
        const v = await verificacionesDe(enCurso, geoms).catch(() => new Map());
        for (const c of canales) {
            const x = c.alerta ? v.get(c.alerta.id) : null;
            if (c.alerta && x?.analisis) c.alerta = { ...c.alerta, verif: { veredicto: x.veredicto, analisis: x.analisis } };
        }
    }

    // OmniVision: qué cámaras analiza y cuánto cuesta cada una (lo mide vision-worker).
    const [enVision, carga, sesion, arbol] = await Promise.all([camarasVision().catch(() => ({ todas: false, ids: new Set<string>() })), cargaVision(), p.auth.pantalla ? null : getSession().catch(() => null),
        leerArbolAreas().catch(() => ({ areas: [], equipoArea: {} as Record<string, string> }))]);
    for (const c of canales) {
        const id = c.equipoId || `nvrch-${c.nvrId}-${c.ch}`;
        c.vision = { analiza: enVision.ids.has(id), porSeg: carga.porCamara[id] ?? null };
        c.areaId = (c.equipoId && arbol.equipoArea[c.equipoId]) || (c.nvrId && arbol.equipoArea[c.nvrId]) || null;
    }

    return NextResponse.json({
        canales,
        // Las áreas de Dispositivos (21/10, Nico: «filtrar las cámaras por áreas también acá»).
        areas: arbol.areas,
        vision: { ...carga, cuantas: enVision.ids.size, puedeCambiar: !!sesion && permisosDeSesion(sesion as any).includes("ajustes") },
        errores,
        vistas: leerVistas(filasAjustes.find((f) => f.key === AJUSTE_VISTAS_CAMARAS)?.value),
        // Seguimiento visual (el mismo Setting que la ficha de intrusión): por cámara, a qué vecinas
        // se pasa y por qué punto. Se manda entero: son pocas cámaras y pocos enlaces.
        seguimiento: (() => { try { return JSON.parse(filasAjustes.find((f) => f.key === "VISUAL_TRACK_LINKS")?.value || "{}"); } catch { return {}; } })(),
        puedeEditar,
        go2rtc: !!streams,
        ventanaAlertaMs: VENTANA_ALERTA_MS,
        ahora: new Date().toISOString(),
    }, { headers: SIN_CACHE });
}
