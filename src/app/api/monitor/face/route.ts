import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor, inicioDelDia, SIN_CACHE } from "@/lib/monitor/servidor";
import { leerDetalleRostro, motivoDeRostro } from "@/lib/monitor/rostro";

export const dynamic = "force-dynamic";

/** Cuántos accesos van en la tira, además del grande. */
const EN_TIRA = 10;
/** La fila de atención: denegados y desconocidos de esta ventana. */
const ATENCION_MS = 60 * 60 * 1000;
const ATENCION_MAX = 20;

/** Sólo las terminales faciales (decisión de Nico, 23/10): ni chapas, ni tarjetas, ni OmniVision. */
const SOLO_ROSTRO = { accessType: "FACE" as const, device: { deviceType: "FACE_TERMINAL" as const } };
const INCLUIR = { user: { select: { name: true, role: true, cara: true, unit: { select: { name: true } } } }, device: { select: { name: true } } } as const;

const forma = (e: any) => {
    const d = leerDetalleRostro(e.details);
    return {
        id: e.id, ts: e.timestamp.toISOString(), decision: e.decision, sentido: e.direction,
        persona: e.user?.name || null, unidad: e.user?.unit?.name || null, rol: e.user?.role || null,
        // La foto del padrón y la que tomó la terminal (entera y el recorte de la cara).
        padron: e.user?.cara || null, foto: e.snapshotPath || e.imagePath || null, recorte: d.recorte,
        nombreTerminal: d.nombre, similitud: d.similitud, terminal: e.device?.name || e.location || null,
        motivo: motivoDeRostro({ decision: e.decision, userId: e.userId, rol: e.user?.role, detalles: e.details }),
    };
};

/**
 * GET /api/monitor/face → el Monitor Face (openspec pared-vms): el último acceso, la tira, los
 * contadores del día y la atención de la última hora. Con sesión pide `rostros` (la página lo pide
 * en el middleware); con enlace de pantalla, sólo el de la vista Face o la rotación.
 */
export async function GET() {
    const p = await autorizarMonitor("/api/monitor/face");
    if (p.error) return p.error;
    const hoy = inicioDelDia();
    const [ultimas, permitidos, denegados, desconocidos, atencion, terminales] = await Promise.all([
        prisma.accessEvent.findMany({ where: SOLO_ROSTRO, orderBy: { timestamp: "desc" }, take: EN_TIRA + 1, include: INCLUIR }),
        prisma.accessEvent.count({ where: { ...SOLO_ROSTRO, timestamp: { gte: hoy }, decision: "GRANT" } }),
        prisma.accessEvent.count({ where: { ...SOLO_ROSTRO, timestamp: { gte: hoy }, decision: "DENY" } }),
        prisma.accessEvent.count({ where: { ...SOLO_ROSTRO, timestamp: { gte: hoy }, decision: "DENY", userId: null } }),
        prisma.accessEvent.findMany({ where: { ...SOLO_ROSTRO, timestamp: { gte: new Date(Date.now() - ATENCION_MS) }, decision: "DENY" }, orderBy: { timestamp: "desc" }, take: ATENCION_MAX, include: INCLUIR }),
        prisma.device.count({ where: { deviceType: "FACE_TERMINAL" } }),
    ]);
    return NextResponse.json({
        ultimas: ultimas.map(forma), atencion: atencion.map(forma),
        hoy: { permitidos, denegados, desconocidos }, terminales, ahora: new Date().toISOString(),
    }, { headers: SIN_CACHE });
}
