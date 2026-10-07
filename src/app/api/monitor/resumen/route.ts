import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor, inicioDelDia, SIN_CACHE } from "@/lib/monitor/servidor";
import { normalizarMatricula } from "@/lib/lista-negra";
import { getActiveAlarms, getAttendingIds } from "@/app/actions/detections";

export const dynamic = "force-dynamic";

/** Cuántos eventos recientes lista el resumen. */
const ULTIMOS_EVENTOS = 8;
/** Una cámara sin muestra de salud en este lapso se da por sin dato, no por caída. */
const MUESTRA_VIGENTE_MS = 10 * 60 * 1000;

/**
 * GET /api/monitor/resumen → los KPI del día del barrio, cada uno con su fuente, el pulso
 * por hora y los últimos eventos. Nada acá se calcula de forma distinta a la pantalla del
 * panel de la que sale: los números tienen que coincidir con lo que ve el operador.
 */
export async function GET() {
    const p = await autorizarMonitor("/api/monitor/resumen");
    if (p.error) return p.error;
    const hoy = inicioDelDia();
    const ahora = new Date();
    const [accesosHoy, invitacionesActivas, entradasInvitados, dispositivos, alertasOffline, pendientes, atendiendo, pulso, ultAcc, ultDet] = await Promise.all([
        prisma.accessEvent.findMany({ where: { timestamp: { gte: hoy } }, orderBy: { timestamp: "asc" }, select: { plateDetected: true, direction: true, decision: true } }),
        prisma.invitation.count({ where: { status: "ACTIVE", validFrom: { lte: ahora }, validTo: { gte: ahora } } }).catch(() => 0),
        prisma.guestEntry.findMany({ where: { timestamp: { gte: hoy } }, orderBy: { timestamp: "asc" }, select: { guestId: true, direction: true } }).catch(() => []),
        prisma.device.findMany({ where: { deviceType: { in: ["LPR_CAMERA", "LPR_INTERIOR", "CAMERA", "NVR"] as any } }, select: { id: true, name: true, deviceType: true } }),
        prisma.deviceAlert.findMany({ where: { active: true, type: "offline" }, select: { deviceId: true, openedAt: true } }).catch(() => []),
        getActiveAlarms().catch(() => []),
        getAttendingIds().catch(() => []),
        prisma.$queryRawUnsafe<{ h: number; n: number }[]>(
            `select extract(hour from "timestamp")::int as h, count(*)::int as n from (
                select "timestamp" from "AccessEvent" where "timestamp" >= $1
                union all select "timestamp" from "PlateSighting" where "timestamp" >= $1
             ) t group by 1 order by 1`, hoy).catch(() => [] as { h: number; n: number }[]),
        prisma.accessEvent.findMany({ orderBy: { timestamp: "desc" }, take: ULTIMOS_EVENTOS, include: { user: { select: { name: true } }, device: { select: { name: true } } } }),
        prisma.detection.findMany({ where: { type: { not: "MOTION" } }, orderBy: { timestamp: "desc" }, take: ULTIMOS_EVENTOS, select: { id: true, timestamp: true, type: true, deviceId: true, snapshotPath: true, acknowledged: true, ackKind: true } }),
    ]);
    // Adentro ahora: última lectura permitida del día por matrícula fue una entrada.
    const ultima = new Map<string, string>();
    let entradas = 0, salidas = 0, denegados = 0;
    for (const e of accesosHoy) {
        if (e.decision === "DENY") { denegados++; continue; }
        if (e.direction === "ENTRY") entradas++; else if (e.direction === "EXIT") salidas++;
        const ch = normalizarMatricula(e.plateDetected); if (ch) ultima.set(ch, e.direction);
    }
    const adentro = [...ultima.values()].filter((d) => d === "ENTRY").length;
    // Visitas activas: invitados con entrada hoy y sin salida posterior.
    const estadoInvitado = new Map<string, string>();
    for (const g of entradasInvitados) estadoInvitado.set(g.guestId, g.direction);
    const visitasAdentro = [...estadoInvitado.values()].filter((d) => d === "ENTRY").length;
    // Cámaras: con alerta offline activa = caída; el resto en línea (el muestreo las vigila cada minuto).
    const caidas = alertasOffline.map((a) => ({ id: a.deviceId, nombre: dispositivos.find((d) => d.id === a.deviceId)?.name || a.deviceId, desde: a.openedAt.toISOString() }));
    const camaras = dispositivos.filter((d) => d.deviceType !== "NVR");
    const nombreDev = Object.fromEntries(dispositivos.map((d) => [d.id, d.name]));
    const eventos = [
        ...ultAcc.map((e) => ({ id: `a_${e.id}`, ts: e.timestamp.toISOString(), clase: "acceso" as const, que: e.plateDetected || e.plateNumber || e.user?.name || "—", donde: e.device?.name || e.location || "", resultado: e.decision, sentido: e.direction, foto: e.snapshotPath || e.imagePath || null })),
        ...ultDet.map((d) => ({ id: `d_${d.id}`, ts: d.timestamp.toISOString(), clase: "deteccion" as const, que: d.type, donde: d.deviceId ? nombreDev[d.deviceId] || d.deviceId : "", resultado: d.acknowledged ? (d.ackKind === "false" ? "FALSA" : "REAL") : "PENDIENTE", sentido: null, foto: d.snapshotPath })),
    ].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, ULTIMOS_EVENTOS);
    const actualizado = ahora.toISOString();
    return NextResponse.json({
        kpi: {
            adentro: { valor: adentro, fuente: "Última lectura permitida de hoy por matrícula fue una entrada (Historial)", actualizado },
            entradas: { valor: entradas, fuente: "Accesos permitidos de entrada desde las 00:00 (Historial)", actualizado },
            salidas: { valor: salidas, fuente: "Accesos permitidos de salida desde las 00:00 (Historial)", actualizado },
            denegados: { valor: denegados, fuente: "Accesos denegados desde las 00:00 (Historial)", actualizado },
            visitas: { valor: visitasAdentro, pases: invitacionesActivas, fuente: "Invitados con entrada registrada hoy y sin salida; pases vigentes ahora (Invitados)", actualizado },
            camaras: { enLinea: camaras.length - caidas.filter((c) => camaras.some((k) => k.id === c.id)).length, total: camaras.length, caidas, fuente: "Salud de dispositivos (muestreo cada minuto, alerta tras dos fallos seguidos)", actualizado },
            alarmas: { pendientes: pendientes.length, confirmadas: atendiendo.length, fuente: "Detecciones de intrusión sin aceptar y cámaras en atención (Monitor de intrusión)", actualizado },
        },
        pulso: Array.from({ length: 24 }, (_, h) => ({ h, n: pulso.find((x) => Number(x.h) === h)?.n || 0 })),
        eventos, ahora: actualizado, muestraVigenteMs: MUESTRA_VIGENTE_MS,
    }, { headers: SIN_CACHE });
}
