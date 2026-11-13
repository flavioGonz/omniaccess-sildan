import { prisma } from "@/lib/prisma";
import { normalizarMatricula } from "@/lib/min-interior";
import { nombreCamara } from "@/lib/rostros";
import { ESTADOS_DE_ESTADIA } from "@/lib/estadias";
import { confirmacionDe, esRequerida } from "@/lib/min-interior";
import { armarSeguimiento, puedeSerLaMisma, type Hecho, type Seguimiento } from "@/lib/seguimiento-chapa";

/**
 * Los hechos de una matrícula para «Seguirlo» (lib/seguimiento-chapa arma la historia).
 *
 * Tres fuentes: los avistamientos de las cámaras de seguimiento (pasos y estadías por chapa), las
 * ocupaciones de las cámaras con franja (la estadía es del lugar; la chapa lo nombra) y las
 * lecturas de acceso.
 *
 * Las malas lecturas: se suman las chapas que difieren en una o dos letras SÓLO en las cámaras
 * donde también se leyó la chapa pedida. Sin esa condición, seguir ABC1234 traería a cualquier
 * ABD1234 del barrio; con ella trae lo que esa cámara leyó distinto del mismo auto. Es una
 * suposición razonable y no una certeza: la respuesta dice con qué chapas se la leyó.
 */
const DIAS_DEFECTO = 7, DIAS_MAX = 30, FILAS_MAX = 800;

export type ListaDeChapa = { categoria: string; requerida: boolean; confirmada: string | null; motivo: string | null; etiqueta: string | null };
export type RespuestaSeguimiento = { chapa: string; dias: number; lista: ListaDeChapa | null; seguimiento: Seguimiento };

export async function seguimientoDeChapa(cruda: string, diasPedidos?: number): Promise<RespuestaSeguimiento | null> {
    const chapa = normalizarMatricula(cruda);
    if (!chapa) return null;
    const dias = Math.min(DIAS_MAX, Math.max(1, Math.round(Number(diasPedidos) || DIAS_DEFECTO)));
    const desde = new Date(Date.now() - dias * 864e5);
    const campos = { id: true, plate: true, deviceId: true, cameraName: true, timestamp: true, estado: true, estDesde: true, estHasta: true, estCerrada: true, snapshotUrl: true } as const;

    const propias = await prisma.plateSighting.findMany({ where: { plate: chapa, timestamp: { gte: desde } }, select: campos, orderBy: { timestamp: "desc" }, take: FILAS_MAX });
    const camaras = [...new Set(propias.map((s) => s.deviceId).filter(Boolean))] as string[];
    // Las otras lecturas de esas mismas cámaras que pueden ser la misma chapa.
    const otras = camaras.length ? (await prisma.plateSighting.groupBy({ by: ["plate"], where: { deviceId: { in: camaras }, timestamp: { gte: desde }, plate: { not: chapa } }, _count: { _all: true } }))
        .map((g) => g.plate).filter((p) => puedeSerLaMisma(chapa, p)) : [];
    const [deVariantes, ocupaciones, accesos, lista] = await Promise.all([
        otras.length ? prisma.plateSighting.findMany({ where: { plate: { in: otras }, deviceId: { in: camaras }, timestamp: { gte: desde } }, select: campos, orderBy: { timestamp: "desc" }, take: FILAS_MAX }) : Promise.resolve([]),
        prisma.ocupacion.findMany({
            where: { hasta: { gte: desde }, OR: [{ plate: chapa }, ...(otras.length ? [{ plate: { in: otras }, deviceId: { in: camaras } }] : [])] },
            select: { id: true, plate: true, deviceId: true, desde: true, hasta: true, cerrada: true, device: { select: { name: true } } }, orderBy: { hasta: "desc" }, take: 200,
        }).catch(() => []),
        prisma.accessEvent.findMany({
            where: { timestamp: { gte: desde }, OR: [{ plateDetected: chapa }, ...(otras.length ? [{ plateDetected: { in: otras }, deviceId: { in: camaras } }] : [])] },
            select: { id: true, plateDetected: true, deviceId: true, timestamp: true, direction: true, decision: true, snapshotPath: true, imagePath: true, device: { select: { name: true } } },
            orderBy: { timestamp: "desc" }, take: 400,
        }),
        prisma.plateWatch.findFirst({ where: { plate: chapa, active: true }, select: { category: true, label: true, motivo: true } }).catch(() => null),
    ]);

    const hechos: Hecho[] = [];
    for (const s of [...propias, ...deVariantes]) {
        const t = s.timestamp.getTime(), camara = nombreCamara(s.cameraName);
        if (ESTADOS_DE_ESTADIA.includes(s.estado as any) && s.estDesde) {
            hechos.push({ tipo: "estadia", id: s.id, plate: s.plate, deviceId: s.deviceId, camara, desde: s.estDesde.getTime(), hasta: (s.estHasta || s.timestamp).getTime(), abierta: !s.estCerrada, foto: s.snapshotUrl });
        } else hechos.push({ tipo: "paso", id: s.id, plate: s.plate, deviceId: s.deviceId, camara, desde: t, hasta: t, foto: s.snapshotUrl });
    }
    for (const o of ocupaciones) if (o.plate) hechos.push({ tipo: "estadia", id: `o-${o.id}`, plate: o.plate, deviceId: o.deviceId, camara: nombreCamara(o.device?.name), desde: o.desde.getTime(), hasta: o.hasta.getTime(), abierta: !o.cerrada, porLugar: true });
    for (const a of accesos) {
        const t = a.timestamp.getTime();
        hechos.push({ tipo: "acceso", id: a.id, plate: normalizarMatricula(a.plateDetected) || chapa, deviceId: a.deviceId, camara: nombreCamara(a.device?.name), desde: t, hasta: t, foto: a.snapshotPath || a.imagePath, sentido: String(a.direction), decision: String(a.decision) });
    }
    return {
        chapa, dias,
        lista: lista ? { categoria: lista.category, requerida: lista.category === "BLACKLISTED" && esRequerida(lista.label, lista.motivo), confirmada: confirmacionDe(lista.motivo), motivo: lista.motivo, etiqueta: nombreCamara(lista.label) } : null,
        seguimiento: armarSeguimiento(chapa, hechos),
    };
}
