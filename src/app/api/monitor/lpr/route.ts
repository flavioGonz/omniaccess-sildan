import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor, inicioDelDia, SIN_CACHE } from "@/lib/monitor/servidor";
import { normalizarMatricula } from "@/lib/lista-negra";
import { metodoDeLectura } from "@/lib/lectura-metodo";

export const dynamic = "force-dynamic";

/** Cuántas lecturas van en la tira de la pared, además de la protagonista. */
const ULTIMAS_EN_TIRA = 10;
/** Ventana de la fila de atención. */
const ATENCION_HORAS = 24;
/** Una matrícula denegada esta cantidad de veces en la ventana es merodeo: mismo umbral que el historial. */
const MERODEO_DENEGADOS = 4;

const forma = (e: any) => ({
    id: e.id, ts: e.timestamp.toISOString(), plate: e.plateDetected || e.plateNumber || null, persona: e.user?.name || null,
    camara: e.device?.name || e.location || null, sentido: e.direction, decision: e.decision, accessType: e.accessType,
    foto: e.snapshotPath || e.imagePath || null, detalles: e.details || null, metodo: metodoDeLectura(e.details || null),
});

/**
 * GET /api/monitor/lpr → la última lectura, la tira, los contadores del día del barrio y la
 * fila de atención (lista negra, en búsqueda, merodeo) de las últimas 24 h.
 */
export async function GET() {
    const p = await autorizarMonitor("/api/monitor/lpr");
    if (p.error) return p.error;
    const hoy = inicioDelDia();
    const desdeAtencion = new Date(Date.now() - ATENCION_HORAS * 3600 * 1000);
    const inc = { user: { select: { name: true } }, device: { select: { name: true } } };
    const [ultimas, entradas, salidas, denegados, recientes] = await Promise.all([
        prisma.accessEvent.findMany({ orderBy: { timestamp: "desc" }, take: ULTIMAS_EN_TIRA + 1, include: inc }),
        prisma.accessEvent.count({ where: { timestamp: { gte: hoy }, direction: "ENTRY", decision: "GRANT" } }),
        prisma.accessEvent.count({ where: { timestamp: { gte: hoy }, direction: "EXIT", decision: "GRANT" } }),
        prisma.accessEvent.count({ where: { timestamp: { gte: hoy }, decision: "DENY" } }),
        prisma.accessEvent.findMany({ where: { timestamp: { gte: desdeAtencion } }, orderBy: { timestamp: "desc" }, take: 500, select: { id: true, timestamp: true, plateDetected: true, decision: true, details: true, direction: true, device: { select: { name: true } } } }),
    ]);
    // Adentro ahora: matrículas cuya última lectura permitida de hoy fue una entrada.
    const ultimaPorChapa = new Map<string, "ENTRY" | "EXIT">();
    const hoyOrdenado = recientes.filter((e) => e.timestamp >= hoy && e.decision === "GRANT").sort((a, b) => +a.timestamp - +b.timestamp);
    for (const e of hoyOrdenado) { const ch = normalizarMatricula(e.plateDetected); if (ch) ultimaPorChapa.set(ch, e.direction as any); }
    const adentro = [...ultimaPorChapa.values()].filter((d) => d === "ENTRY").length;

    // Fila de atención.
    const chapas = [...new Set(recientes.map((e) => normalizarMatricula(e.plateDetected)).filter(Boolean))] as string[];
    const vigiladas = chapas.length ? await prisma.plateWatch.findMany({ where: { active: true, plate: { in: chapas }, category: { in: ["BLACKLISTED", "SEARCH"] } }, select: { plate: true, category: true, motivo: true, label: true } }).catch(() => []) : [];
    const porChapa = new Map(vigiladas.map((v) => [normalizarMatricula(v.plate), v]));
    const denegadasPorChapa = new Map<string, number>();
    for (const e of recientes) { const ch = normalizarMatricula(e.plateDetected); if (ch && e.decision === "DENY") denegadasPorChapa.set(ch, (denegadasPorChapa.get(ch) || 0) + 1); }
    const vistas = new Set<string>();
    const atencion: { plate: string; tipo: "LISTA_NEGRA" | "EN_BUSQUEDA" | "MERODEO"; motivo: string; ts: string; camara: string | null; veces?: number }[] = [];
    for (const e of recientes) {
        const ch = normalizarMatricula(e.plateDetected); if (!ch || vistas.has(ch)) continue;
        const v = porChapa.get(ch);
        if (v) { vistas.add(ch); atencion.push({ plate: ch, tipo: v.category === "SEARCH" ? "EN_BUSQUEDA" : "LISTA_NEGRA", motivo: v.motivo || v.label || "sin motivo cargado", ts: e.timestamp.toISOString(), camara: e.device?.name || null }); continue; }
        if ((denegadasPorChapa.get(ch) || 0) >= MERODEO_DENEGADOS) { vistas.add(ch); atencion.push({ plate: ch, tipo: "MERODEO", motivo: `${denegadasPorChapa.get(ch)} lecturas denegadas en ${ATENCION_HORAS} h`, ts: e.timestamp.toISOString(), camara: e.device?.name || null, veces: denegadasPorChapa.get(ch) }); }
    }
    return NextResponse.json({
        ultima: ultimas[0] ? forma(ultimas[0]) : null,
        tira: ultimas.slice(1, ULTIMAS_EN_TIRA + 1).map(forma),
        contadores: { entradas, salidas, denegados, adentro, actualizado: new Date().toISOString(), dia: hoy.toISOString() },
        atencion, ahora: new Date().toISOString(),
    }, { headers: SIN_CACHE });
}
