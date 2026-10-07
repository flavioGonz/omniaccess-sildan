import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor, inicioDelDia, SIN_CACHE } from "@/lib/monitor/servidor";
import { normalizarMatricula } from "@/lib/lista-negra";
import { formaLectura, INCLUIR_LECTURA } from "@/lib/monitor/lecturas";

export const dynamic = "force-dynamic";

/** Cuántos pasos de hoy de la misma matrícula trae la ficha. */
const PASOS_DE_HOY = 20;

/**
 * GET /api/monitor/lpr/lectura/<id> → la ficha de una lectura para la pantalla táctil:
 * la lectura, de quién es el vehículo (nombre, rol y lote — nunca teléfono ni documento: es
 * una pantalla de pared), el vehículo, si está en la lista de vigilancia, si es un invitado
 * (a qué lote va y hasta cuándo vale el pase), y los pasos de hoy de esa matrícula.
 *
 * Va bajo /api/monitor/lpr/ para que un enlace de pantalla de la vista LPR la pueda leer sin
 * abrir nada más.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const p = await autorizarMonitor("/api/monitor/lpr/lectura");
    if (p.error) return p.error;
    const { id } = await params;
    const e = await prisma.accessEvent.findUnique({
        where: { id },
        include: { ...INCLUIR_LECTURA, user: { select: { name: true, role: true, unit: { select: { name: true } } } } },
    }).catch(() => null);
    if (!e) return NextResponse.json({ error: "Esa lectura ya no existe" }, { status: 404, headers: SIN_CACHE });

    const chapa = normalizarMatricula(e.plateDetected);
    const hoy = inicioDelDia();
    const [vehiculo, credencial, vigilancia, invitado, pasos] = chapa ? await Promise.all([
        prisma.vehicle.findFirst({ where: { plate: chapa }, select: { brand: true, model: true, color: true, type: true, user: { select: { name: true, role: true, unit: { select: { name: true } } } } } }).catch(() => null),
        prisma.credential.findFirst({ where: { type: "PLATE", value: chapa }, select: { user: { select: { name: true, role: true, unit: { select: { name: true } } } } } }).catch(() => null),
        prisma.plateWatch.findFirst({ where: { plate: chapa, active: true }, select: { category: true, motivo: true, label: true } }).catch(() => null),
        prisma.guestPlate.findFirst({
            where: { plate: chapa, guest: { invitation: { status: "ACTIVE" as any, validTo: { gte: new Date() } } } },
            select: { guest: { select: { name: true, invitation: { select: { hostName: true, hostLabel: true, validFrom: true, validTo: true } } } } },
        }).catch(() => null),
        prisma.accessEvent.findMany({ where: { plateDetected: chapa, timestamp: { gte: hoy } }, orderBy: { timestamp: "desc" }, take: PASOS_DE_HOY, select: { id: true, timestamp: true, direction: true, decision: true, device: { select: { name: true } } } }).catch(() => []),
    ]) : [null, null, null, null, []];

    // De quién es: el usuario de la lectura; si no lo trae, el dueño del vehículo o de la credencial.
    const duenio = e.user || vehiculo?.user || credencial?.user || null;
    // Adentro desde: la última lectura permitida de hoy, si fue una entrada.
    const ultimaPermitida = (pasos as any[]).find((x) => x.decision === "GRANT");

    return NextResponse.json({
        lectura: formaLectura(e),
        persona: duenio ? { nombre: duenio.name, rol: duenio.role, unidad: duenio.unit?.name || null } : null,
        vehiculo: vehiculo ? { marca: vehiculo.brand, modelo: vehiculo.model, color: vehiculo.color, tipo: vehiculo.type } : null,
        vigilancia: vigilancia ? { categoria: vigilancia.category, motivo: vigilancia.motivo || vigilancia.label || null } : null,
        invitado: invitado ? { nombre: invitado.guest.name || null, anfitrion: invitado.guest.invitation.hostName || null, lote: invitado.guest.invitation.hostLabel || null, desde: invitado.guest.invitation.validFrom.toISOString(), hasta: invitado.guest.invitation.validTo.toISOString() } : null,
        hoy: (pasos as any[]).map((x) => ({ id: x.id, ts: x.timestamp.toISOString(), sentido: x.direction, decision: x.decision, camara: x.device?.name || null })),
        adentroDesde: ultimaPermitida?.direction === "ENTRY" ? ultimaPermitida.timestamp.toISOString() : null,
    }, { headers: SIN_CACHE });
}
