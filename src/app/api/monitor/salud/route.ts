import { NextResponse } from "next/server";
import { exec } from "child_process";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor, SIN_CACHE } from "@/lib/monitor/servidor";
import { estadoDelSistema } from "@/lib/estado-sistema";

export const dynamic = "force-dynamic";

/** Una muestra de salud más vieja que esto ya no dice nada: el equipo pasa a "sin dato". */
const MUESTRA_VIGENTE_MS = 10 * 60 * 1000;
/** El bot: si hace más de esto que no se registra un mensaje, no se puede afirmar que anda; se mira la sesión. */
const BOT_SILENCIO_MS = 6 * 3600 * 1000;
/** Los procesos PM2 que tienen que estar arriba. */
const PROCESOS = ["omniaccess-web", "omniaccess-webhooks", "tracking-worker", "dispatch-worker"];

type Estado = "bien" | "degradado" | "caido" | "sinDato";
type Componente = { id: string; grupo: "camaras" | "nvr" | "servicios" | "procesos"; nombre: string; estado: Estado; detalle: string; respondio: string | null; caidoDesde: string | null };

const salida = (cmd: string) => new Promise<string>((res) => exec(cmd, { timeout: 4000 }, (e, out) => res(e ? "" : String(out || "").trim())));

/**
 * GET /api/monitor/salud → cada componente con su estado y hace cuánto respondió. Agrega lo
 * que ya se muestrea (salud de dispositivos, alertas offline) y lo que /api/system-status
 * chequea en vivo (base, MinIO, bot, Omni-LPR), más los procesos PM2.
 */
export async function GET() {
    const p = await autorizarMonitor("/api/monitor/salud");
    if (p.error) return p.error;
    const ahora = Date.now();
    const comps: Componente[] = [];

    const [devs, alertas, muestras, bot, ultimoMsg] = await Promise.all([
        prisma.device.findMany({ where: { deviceType: { in: ["LPR_CAMERA", "LPR_INTERIOR", "CAMERA", "NVR", "FACE_TERMINAL", "ACCESS_CONTROL"] as any } }, select: { id: true, name: true, deviceType: true, ip: true } }),
        prisma.deviceAlert.findMany({ where: { active: true }, select: { deviceId: true, type: true, severity: true, message: true, openedAt: true } }).catch(() => []),
        prisma.$queryRawUnsafe<{ deviceId: string; ts: Date; reachable: boolean; latencyMs: number | null }[]>(
            `select distinct on ("deviceId") "deviceId", ts, reachable, "latencyMs" from "DeviceHealthSample" order by "deviceId", ts desc`).catch(() => []),
        prisma.whatsAppSession.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }).catch(() => null),
        prisma.wahaRequestLog.findFirst({ orderBy: { timestamp: "desc" }, select: { timestamp: true, status: true } }).catch(() => null),
    ]);
    const muestra = new Map(muestras.map((m) => [m.deviceId, m]));
    const alerta = (id: string) => alertas.filter((a) => a.deviceId === id);
    for (const d of devs) {
        const m = muestra.get(d.id); const al = alerta(d.id); const off = al.find((a) => a.type === "offline");
        let estado: Estado = "sinDato", detalle = "sin muestreo: este tipo de equipo no se chequea cada minuto";
        if (m) {
            const vieja = ahora - +m.ts > MUESTRA_VIGENTE_MS;
            if (off) { estado = "caido"; detalle = off.message; }
            else if (vieja) { estado = "sinDato"; detalle = "la última muestra es vieja: el muestreo no está corriendo"; }
            else if (!m.reachable) { estado = "degradado"; detalle = "no respondió en la última muestra (todavía sin alerta)"; }
            else if (al.length) { estado = "degradado"; detalle = al.map((a) => a.message).join(" · "); }
            else { estado = "bien"; detalle = m.latencyMs != null ? `responde en ${m.latencyMs} ms` : "responde"; }
        }
        comps.push({ id: d.id, grupo: d.deviceType === "NVR" ? "nvr" : "camaras", nombre: d.name, estado, detalle, respondio: m ? new Date(m.ts).toISOString() : null, caidoDesde: off ? off.openedAt.toISOString() : null });
    }

    // Servicios: lo que ya chequea /api/system-status, llamado acá mismo para no duplicar la lógica.
    let sistema: any = {};
    try { sistema = await estadoDelSistema(); } catch { }
    const svc = (id: string, nombre: string, s: any, extra?: string) => {
        const st: Estado = !s ? "sinDato" : s.status === "connected" ? "bien" : s.status === "disabled" ? "sinDato" : "caido";
        comps.push({ id, grupo: "servicios", nombre, estado: st, detalle: !s ? "sin respuesta del chequeo" : s.status === "disabled" ? "no configurado" : st === "bien" ? `${extra || "responde"}${s.latency ? ` · ${s.latency} ms` : ""}` : "no responde", respondio: st === "bien" ? new Date().toISOString() : null, caidoDesde: null });
    };
    svc("db", "Base de datos", sistema.primaryDb, sistema.primaryDb?.details?.version ? `PostgreSQL ${sistema.primaryDb.details.version}` : undefined);
    svc("minio", "Almacenamiento (MinIO)", sistema.minio);
    svc("omnilpr", "Lector de matrículas (Omni-LPR)", sistema.omniLprEnabled === false ? { status: "disabled" } : sistema.omniLpr, sistema.omniLpr?.details?.version);
    // El bot: sesión WORKING según WAHA, y además si hace poco que habló.
    {
        const w = sistema.waha; const sesion = w?.details?.sessionStatus;
        const callado = ultimoMsg ? ahora - +ultimoMsg.timestamp > BOT_SILENCIO_MS : true;
        const st: Estado = !w || w.status === "disabled" ? "sinDato" : w.status !== "connected" ? "caido" : sesion === "WORKING" ? (callado ? "degradado" : "bien") : "caido";
        comps.push({ id: "bot", grupo: "servicios", nombre: "Bot de WhatsApp", estado: st, detalle: !w || w.status === "disabled" ? "no configurado" : w.status !== "connected" ? "la pasarela no responde" : sesion !== "WORKING" ? `sesión ${sesion || "sin sesión"}: hay que escanear el QR` : callado ? `sesión activa, pero sin mensajes hace más de ${BOT_SILENCIO_MS / 3600000} h` : "sesión activa y conversando", respondio: ultimoMsg ? ultimoMsg.timestamp.toISOString() : (bot ? bot.updatedAt.toISOString() : null), caidoDesde: null });
    }
    // Procesos PM2.
    try {
        const lista = JSON.parse((await salida("pm2 jlist")) || "[]");
        for (const nombre of PROCESOS) {
            const x = lista.find((q: any) => q.name === nombre);
            const online = x?.pm2_env?.status === "online";
            comps.push({ id: `pm2:${nombre}`, grupo: "procesos", nombre, estado: !x ? "sinDato" : online ? "bien" : "caido", detalle: !x ? "no figura en PM2" : online ? `arriba · ${x.pm2_env?.restart_time || 0} reinicios · ${Math.round((x.monit?.memory || 0) / 1048576)} MB` : `estado ${x.pm2_env?.status}`, respondio: online ? new Date().toISOString() : null, caidoDesde: !x || online ? null : (x.pm2_env?.pm_uptime ? new Date(x.pm2_env.pm_uptime).toISOString() : null) });
        }
    } catch { for (const nombre of PROCESOS) comps.push({ id: `pm2:${nombre}`, grupo: "procesos", nombre, estado: "sinDato", detalle: "PM2 no contestó", respondio: null, caidoDesde: null }); }

    const conProblemas = comps.filter((c) => c.estado === "caido" || c.estado === "degradado");
    const sinDato = comps.filter((c) => c.estado === "sinDato").length;
    return NextResponse.json({ componentes: comps, resumen: { total: comps.length, conProblemas: conProblemas.length, sinDato, primero: conProblemas.slice(0, 5).map((c) => c.nombre) }, ahora: new Date().toISOString() }, { headers: SIN_CACHE });
}
