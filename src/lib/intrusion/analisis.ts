import { prisma } from "@/lib/prisma";
import { getBarrioMap } from "@/app/actions/barriomap";

/**
 * El análisis de una detección de intrusión: lo que la base ya sabe alrededor de ese
 * instante y que el operador tendría que ir a buscar a tres pantallas.
 *
 * No da un veredicto. Una cámara que cruza "persona" no se vuelve falsa porque otras veces
 * lo fue; lo que se muestra son INDICIOS, cada uno con el número de donde sale, para que la
 * decisión la tome alguien con la foto delante:
 *
 *  · Ráfaga: cuántas detecciones hubo en la misma cámara alrededor (una persona caminando
 *    frente a la línea dispara varias en pocos segundos; no son varias intrusiones).
 *  · Ritmo: cuántas lleva hoy esta cámara a esta hora contra lo habitual de los 7 días previos.
 *  · Historial de la cámara: de las últimas que alguien revisó, cuántas fueron falsas.
 *  · Otras cámaras: si otra cámara detectó algo minutos antes o después — un recorrido.
 *  · Lecturas LPR cercanas: qué matrículas pasaron por las lectoras en ese margen.
 *  · El mapa: dónde está la cámara y su línea o zona, para ubicar el cruce en el barrio.
 */

/** Margen de la ráfaga: detecciones de la misma cámara a menos de esto son el mismo episodio. */
const RAFAGA_MS = 5 * 60_000;
/** Margen para buscar otras cámaras y lecturas LPR alrededor. */
const ALREDEDOR_MS = 3 * 60_000;
/** Cuántas revisadas de la cámara se miran para el historial. */
const HISTORIAL_REVISADAS = 50;
/** Debajo de esto, el historial no dice nada todavía. */
const HISTORIAL_MINIMO = 5;
/** Días hacia atrás para saber qué es lo habitual a esta hora. */
const DIAS_HABITUAL = 7;
/** Cuánto más que lo habitual hace falta para llamarlo inusual (y un piso, para no gritar por 2 contra 0,5). */
const INUSUAL_FACTOR = 3;
const INUSUAL_MINIMO = 3;
/** La franja que se marca como noche. */
const NOCHE_DESDE = 22, NOCHE_HASTA = 6;

export type Indicio = { tono: "mal" | "aviso" | "bien" | "info" | "neutro"; texto: string };
export type AnalisisDeteccion = {
    deteccion: { id: string; deviceId: string | null; deviceName: string | null; type: string; label: string | null; timestamp: string; acknowledged: boolean; ackKind: string | null };
    rafaga: { cantidad: number; desde: string; hasta: string };
    ritmo: { hoyEnLaHora: number; habitualPorHora: number; hoy: number };
    historial: { revisadas: number; falsas: number; reales: number };
    otrasCamaras: { deviceId: string | null; nombre: string; type: string; timestamp: string }[];
    lecturas: { plate: string; camara: string | null; sentido: string | null; timestamp: string }[];
    mapa: {
        centro: [number, number]; zoom: number;
        camara: { lat: number; lng: number; rumbo: number } | null;
        figuras: { kind: string; points: [number, number][] }[];
        otras: { nombre: string; lat: number; lng: number }[];
    } | null;
    indicios: Indicio[];
};

const hora = (d: Date) => d.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export async function analizarDeteccion(id: string): Promise<AnalisisDeteccion | null> {
    const det = await prisma.detection.findUnique({ where: { id } });
    if (!det) return null;
    const t = det.timestamp.getTime();
    const dev = det.deviceId ? await prisma.device.findUnique({ where: { id: det.deviceId }, select: { id: true, name: true } }) : null;
    const analitica = { type: { not: "MOTION" } };

    const inicioHora = new Date(t); inicioHora.setMinutes(0, 0, 0);
    const finHora = new Date(inicioHora.getTime() + 3600_000);
    const inicioDia = new Date(t); inicioDia.setHours(0, 0, 0, 0);

    const [rafaga, hoyEnLaHora, hoy, revisadas, alrededor, lecturas, mapa, previas] = await Promise.all([
        det.deviceId ? prisma.detection.findMany({ where: { deviceId: det.deviceId, ...analitica, timestamp: { gte: new Date(t - RAFAGA_MS), lte: new Date(t + RAFAGA_MS) } }, select: { timestamp: true }, orderBy: { timestamp: "asc" } }) : Promise.resolve([]),
        det.deviceId ? prisma.detection.count({ where: { deviceId: det.deviceId, ...analitica, timestamp: { gte: inicioHora, lt: finHora } } }) : Promise.resolve(0),
        det.deviceId ? prisma.detection.count({ where: { deviceId: det.deviceId, ...analitica, timestamp: { gte: inicioDia, lte: det.timestamp } } }) : Promise.resolve(0),
        det.deviceId ? prisma.detection.findMany({ where: { deviceId: det.deviceId, ...analitica, acknowledged: true, id: { not: det.id } }, select: { ackKind: true }, orderBy: { timestamp: "desc" }, take: HISTORIAL_REVISADAS }) : Promise.resolve([]),
        prisma.detection.findMany({ where: { ...analitica, deviceId: { not: det.deviceId }, timestamp: { gte: new Date(t - ALREDEDOR_MS), lte: new Date(t + ALREDEDOR_MS) } }, select: { deviceId: true, type: true, timestamp: true }, orderBy: { timestamp: "asc" }, take: 20 }),
        prisma.accessEvent.findMany({ where: { timestamp: { gte: new Date(t - ALREDEDOR_MS), lte: new Date(t + ALREDEDOR_MS) } }, select: { plateDetected: true, direction: true, timestamp: true, device: { select: { name: true } } }, orderBy: { timestamp: "asc" }, take: 12 }),
        getBarrioMap().catch(() => null),
        // Lo habitual a esta hora: las de esta cámara en la misma hora de los 7 días anteriores.
        det.deviceId ? Promise.all(Array.from({ length: DIAS_HABITUAL }, (_, i) => {
            const a = new Date(inicioHora.getTime() - (i + 1) * 86_400_000);
            return prisma.detection.count({ where: { deviceId: det.deviceId, ...analitica, timestamp: { gte: a, lt: new Date(a.getTime() + 3600_000) } } });
        })) : Promise.resolve([] as number[]),
    ]);

    // Una cámara por grupo, la detección más cercana al instante.
    const idsOtras = [...new Set(alrededor.map((x) => x.deviceId).filter(Boolean))] as string[];
    const nombres = idsOtras.length ? await prisma.device.findMany({ where: { id: { in: idsOtras } }, select: { id: true, name: true } }) : [];
    const nombreDe = new Map(nombres.map((n) => [n.id, n.name]));
    const otrasCamaras = idsOtras.map((did) => {
        const x = alrededor.filter((a) => a.deviceId === did).sort((a, b) => Math.abs(a.timestamp.getTime() - t) - Math.abs(b.timestamp.getTime() - t))[0];
        return { deviceId: did, nombre: nombreDe.get(did) || "Cámara", type: x.type, timestamp: x.timestamp.toISOString() };
    });

    const falsas = revisadas.filter((r) => r.ackKind === "false").length;
    const reales = revisadas.length - falsas;
    const habitual = previas.length ? previas.reduce((s, n) => s + n, 0) / previas.length : 0;

    // El mapa: la cámara, su línea o zona, y las otras cámaras que también detectaron.
    let mapaOut: AnalisisDeteccion["mapa"] = null;
    if (mapa && det.deviceId) {
        const cams: any[] = Array.isArray(mapa.cameras) ? mapa.cameras : [];
        const c = cams.find((x) => x.deviceId === det.deviceId);
        const figuras = (Array.isArray(mapa.intrusions) ? mapa.intrusions : []).filter((f: any) => f.deviceId === det.deviceId && Array.isArray(f.points)).map((f: any) => ({ kind: String(f.kind || "zone"), points: f.points }));
        const otras = otrasCamaras.map((o) => { const p = cams.find((x) => x.deviceId === o.deviceId); return p ? { nombre: o.nombre, lat: p.lat, lng: p.lng } : null; }).filter(Boolean) as { nombre: string; lat: number; lng: number }[];
        if (c || figuras.length) {
            const centro: [number, number] = c ? [c.lat, c.lng] : figuras[0].points[0];
            mapaOut = { centro, zoom: Math.max(17, Number(mapa.zoom) || 18), camara: c ? { lat: c.lat, lng: c.lng, rumbo: Number(c.rumbo) || 0 } : null, figuras, otras };
        }
    }

    // Los indicios, en el orden en que importan.
    const indicios: Indicio[] = [];
    const clase = det.label === "human" ? "persona" : det.label === "vehicle" ? "vehículo" : null;
    if (clase) indicios.push({ tono: "info", texto: `La cámara lo clasificó como ${clase}.` });
    if (rafaga.length > 1) {
        const dur = Math.max(1, Math.round((rafaga[rafaga.length - 1].timestamp.getTime() - rafaga[0].timestamp.getTime()) / 1000));
        indicios.push({ tono: "neutro", texto: `${rafaga.length} detecciones de esta cámara en ${dur < 90 ? `${dur} s` : `${Math.round(dur / 60)} min`} (${hora(rafaga[0].timestamp)} a ${hora(rafaga[rafaga.length - 1].timestamp)}): es un mismo episodio, no ${rafaga.length} intrusiones.` });
    }
    const h = det.timestamp.getHours();
    if (h >= NOCHE_DESDE || h < NOCHE_HASTA) indicios.push({ tono: "aviso", texto: `Fue de noche (${hora(det.timestamp)}).` });
    if (hoyEnLaHora >= INUSUAL_MINIMO && hoyEnLaHora > habitual * INUSUAL_FACTOR) indicios.push({ tono: "aviso", texto: `Más movimiento que lo habitual: ${hoyEnLaHora} en esta hora, contra ${habitual.toFixed(1)} de promedio a la misma hora los últimos ${DIAS_HABITUAL} días.` });
    if (revisadas.length >= HISTORIAL_MINIMO) {
        const pf = Math.round((falsas / revisadas.length) * 100);
        indicios.push({ tono: pf >= 70 ? "bien" : pf <= 30 ? "mal" : "neutro", texto: `De las últimas ${revisadas.length} revisadas de esta cámara, ${falsas} fueron falsas alarmas (${pf} %).` });
    }
    if (otrasCamaras.length) indicios.push({ tono: "aviso", texto: `También detectó ${otrasCamaras.map((o) => `${o.nombre} a las ${hora(new Date(o.timestamp))}`).join(", ")}: puede ser un recorrido.` });
    const conChapa = lecturas.filter((l) => l.plateDetected && !/NO_?LEIDA|unknown|S\/P/i.test(l.plateDetected));
    if (conChapa.length) indicios.push({ tono: "info", texto: `Lecturas LPR en ±${ALREDEDOR_MS / 60000} min: ${conChapa.slice(0, 4).map((l) => `${l.plateDetected} (${l.direction === "EXIT" ? "salida" : "entrada"} ${hora(l.timestamp)})`).join(", ")}${conChapa.length > 4 ? "…" : ""}.` });

    return {
        deteccion: { id: det.id, deviceId: det.deviceId, deviceName: dev?.name || null, type: det.type, label: det.label, timestamp: det.timestamp.toISOString(), acknowledged: det.acknowledged, ackKind: det.ackKind },
        rafaga: { cantidad: rafaga.length, desde: (rafaga[0]?.timestamp || det.timestamp).toISOString(), hasta: (rafaga[rafaga.length - 1]?.timestamp || det.timestamp).toISOString() },
        ritmo: { hoyEnLaHora, habitualPorHora: Math.round(habitual * 10) / 10, hoy },
        historial: { revisadas: revisadas.length, falsas, reales },
        otrasCamaras,
        lecturas: conChapa.map((l) => ({ plate: l.plateDetected!, camara: l.device?.name || null, sentido: l.direction || null, timestamp: l.timestamp.toISOString() })),
        mapa: mapaOut,
        indicios,
    };
}
