import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor, inicioDelDia, SIN_CACHE } from "@/lib/monitor/servidor";
import { eventosPendientes } from "@/lib/centrales/tratamiento";
import { leerPrioridadesGuardadas } from "@/lib/centrales/prioridades-servidor";
import { prioridadDe } from "@/lib/centrales/prioridades";
import { camarasDeEvento } from "@/lib/centrales/camaras";
import { origenProcedimiento } from "@/lib/centrales/tratamiento-tipos";
import { exigirFuncion } from "@/lib/funcion-servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/monitor/centrales → lo que necesita la pared «Alarmas» (23/10, Nico: «tomar las alarmas
 * del hub… la recepción de eventos debe ser muy rápida, ya que tenemos que verificar cada evento con
 * video verificación en vivo»).
 *
 * Es sólo lectura y se pide cada pocos segundos; lo que la hace rápida es el socket (la vista arranca
 * el video con lo que trae `general_detection`, antes de esta consulta). Acá se completa:
 *
 *  · pendientes: las alarmas de central sin tratar (las mismas de Gestión de alarmas, en el mismo
 *    orden: prioridad y después la más nueva), con las cámaras de su zona ya resueltas a nombre y a
 *    stream de go2rtc (`lpr_<id>`, el mismo que usa alarm-receiver para sacar el cuadro), y los
 *    cuadros que se guardaron en el momento;
 *  · recientes: lo último que llegó de las centrales, evento por evento (sin la supervisión, que es
 *    un latido cada pocos minutos y taparía todo);
 *  · centrales: cada una con si reporta y su último armado o desarmado;
 *  · hoy: cuántas alarmas, cuántas tratadas, cuántas falsas.
 */

/** Hasta cuántas horas atrás cuenta una alarma pendiente: lo mismo que Gestión de alarmas. */
const HORAS_PENDIENTES = 24;
const RECIENTES = 40;
/** Cuántas pendientes traen su video resuelto (las que pueden estar al frente o elegirse de la cola). */
const CON_VIDEO = 12;
/** El último armado se busca hasta acá: una central que no se arma hace un mes dice «sin dato». */
const DIAS_ARMADO = 30;

type EventoMsg = { categoria?: string; tipo?: string; texto?: string; codigo?: string | null; zona?: number | null; particion?: number | null; usuario?: number | string | null; restaura?: boolean; propio?: boolean; nombre?: string | null };
const detalles = (s: string | null) => { try { return JSON.parse(s || "{}") || {}; } catch { return {}; } };

export async function GET() {
    const funcionApagada = await exigirFuncion("FUNC_ALARMAS_GESTION"); if (funcionApagada) return funcionApagada;
    const p = await autorizarMonitor("/api/monitor/centrales");
    if (p.error) return p.error;
    try {
        const desdeRecientes = new Date(Date.now() - 24 * 3600_000);
        const [pendientes, centrales, mensajes, prioridades, hoyDets] = await Promise.all([
            eventosPendientes(null, HORAS_PENDIENTES),
            prisma.centralAlarma.findMany({ select: { id: true, cuenta: true, deviceId: true, estado: true, prueba: true, ultimoMensajeAt: true, supervisionSeg: true, device: { select: { name: true } }, zonas: { select: { zona: true, nombre: true } } }, orderBy: { createdAt: "asc" } }),
            prisma.mensajeCentral.findMany({
                where: { recibido: { gte: desdeRecientes }, error: null, NOT: { idMensaje: "NULL" } },
                orderBy: { recibido: "desc" }, take: RECIENTES,
                select: { id: true, recibido: true, centralId: true, cuenta: true, eventos: true, detectionId: true },
            }),
            leerPrioridadesGuardadas(),
            prisma.detection.findMany({ where: { type: "CENTRAL", timestamp: { gte: inicioDelDia() } }, select: { acknowledged: true, ackKind: true } }),
        ]);

        // Los detalles de cada pendiente (código, texto, cuadros) y los nombres de sus cámaras.
        const dets = pendientes.length ? await prisma.detection.findMany({ where: { id: { in: pendientes.map((e) => e.id) } }, select: { id: true, details: true, snapshotPath: true } }) : [];
        const det = new Map(dets.map((d) => [d.id, { ...detalles(d.details), snapshotPath: d.snapshotPath }]));
        // La video verificación (zona → área → abonado, y las otras del abonado) de las primeras: son las
        // que pueden estar al frente; el resto de la cola no muestra video.
        const video = new Map(await Promise.all(pendientes.slice(0, CON_VIDEO).map(async (e) => [e.id, await camarasDeEvento(e.central.id, e.zona?.zona ?? null).catch(() => null)] as const)));

        // El último armado o desarmado de cada central (una consulta por central: son pocas).
        const desdeArmado = new Date(Date.now() - DIAS_ARMADO * 86400_000);
        const armados = await Promise.all(centrales.map((c) => prisma.mensajeCentral.findFirst({
            where: { centralId: c.id, recibido: { gte: desdeArmado }, OR: [{ eventos: { array_contains: [{ categoria: "ARMADO" }] } }, { eventos: { array_contains: [{ categoria: "DESARMADO" }] } }] },
            orderBy: { recibido: "desc" }, select: { recibido: true, eventos: true },
        }).catch(() => null)));

        const porCentral = new Map(centrales.map((c) => [c.id, c]));
        const enAlarma = new Map<string, number>();
        for (const e of pendientes) enAlarma.set(e.central.id, (enAlarma.get(e.central.id) || 0) + 1);

        return NextResponse.json({
            ahora: new Date().toISOString(),
            // Para darle prioridad a la alarma que llega por el socket, antes de esta consulta.
            prioridades,
            pendientes: pendientes.map((e) => {
                const x = det.get(e.id) || {};
                return {
                    id: e.id, ts: e.ts, tipo: e.tipo, titulo: e.titulo, prioridad: e.prioridad, area: e.area, particion: e.particion,
                    central: { id: e.central.id, nombre: e.central.nombre, cuenta: e.central.cuenta, prueba: e.central.prueba },
                    zona: e.zona ? { zona: e.zona.zona, nombre: e.zona.nombre } : null,
                    codigo: x.codigo || null, texto: x.texto || null, usuario: x.usuario ?? null,
                    camaras: video.get(e.id)?.camaras || [],
                    otras: video.get(e.id)?.otras || [],
                    origenCamaras: video.get(e.id) ? { origen: video.get(e.id)!.origen, area: video.get(e.id)!.area } : null,
                    fotos: (Array.isArray(x.fotos) ? x.fotos : x.snapshotPath ? [{ camara: e.zona?.camaras?.[0] || null, foto: x.snapshotPath }] : []).slice(0, 4),
                    operador: e.operador.nombre ? { nombre: e.operador.nombre, desde: e.operador.desde } : null,
                    // El avance del procedimiento, para mirarlo (la pared no tilda nada).
                    procedimiento: e.procedimiento ? {
                        origen: origenProcedimiento(e.procedimiento),
                        pasos: e.procedimiento.pasos.map((q) => {
                            const h = e.pasos[q.texto], sl = e.salteos[q.texto];
                            return { texto: q.texto, obligatorio: q.obligatorio, estado: h ? "hecho" : sl ? "salteado" : "pendiente", por: h?.por || sl?.por || null, ts: h?.ts || sl?.ts || null, motivo: sl?.motivo || null };
                        }),
                    } : null,
                    escalado: e.escalado,
                };
            }),
            recientes: mensajes.flatMap((m) => {
                const c = m.centralId ? porCentral.get(m.centralId) : undefined;
                const evs = (Array.isArray(m.eventos) ? m.eventos : []) as EventoMsg[];
                return evs.map((ev, i) => ({
                    id: `${m.id}:${i}`, ts: m.recibido.toISOString(), central: c?.device?.name || `Cuenta ${m.cuenta || "?"}`,
                    categoria: ev.categoria || "OTRO", tipo: ev.tipo || null, texto: ev.texto || "Evento", codigo: ev.codigo || null,
                    zona: ev.zona ?? null, zonaNombre: ev.zona != null ? c?.zonas.find((z) => z.zona === ev.zona)?.nombre || null : null,
                    particion: ev.particion ?? null, usuario: ev.usuario ?? null, restaura: !!ev.restaura, propio: !!ev.propio,
                    prioridad: prioridadDe(prioridades, ev), detectionId: m.detectionId,
                }));
            }).slice(0, RECIENTES),
            centrales: centrales.map((c, i) => {
                const a = armados[i];
                const ev = a ? ((Array.isArray(a.eventos) ? a.eventos : []) as EventoMsg[]).find((x) => x.categoria === "ARMADO" || x.categoria === "DESARMADO") : null;
                return {
                    id: c.id, nombre: c.device?.name || `Central ${c.cuenta}`, cuenta: c.cuenta, estado: c.estado, prueba: c.prueba,
                    ultimoMensajeAt: c.ultimoMensajeAt?.toISOString() || null, supervisionSeg: c.supervisionSeg,
                    armado: ev ? { armada: ev.categoria === "ARMADO", presente: ev.tipo === "PRESENTE", texto: ev.texto || null, particion: ev.particion ?? null, usuario: ev.usuario ?? null, ts: a!.recibido.toISOString() } : null,
                    enAlarma: enAlarma.get(c.id) || 0,
                };
            }),
            hoy: { alarmas: hoyDets.length, tratadas: hoyDets.filter((d) => d.acknowledged).length, falsas: hoyDets.filter((d) => d.acknowledged && d.ackKind === "false").length },
        }, { headers: SIN_CACHE });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "No se pudieron leer las centrales" }, { status: 500 });
    }
}
