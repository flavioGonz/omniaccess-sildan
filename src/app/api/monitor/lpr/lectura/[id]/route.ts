import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor, inicioDelDia, SIN_CACHE } from "@/lib/monitor/servidor";
import { normalizarMatricula } from "@/lib/lista-negra";
import { formaLectura, INCLUIR_LECTURA } from "@/lib/monitor/lecturas";
import { registradas } from "@/lib/visitas/registro";
import { ZONA } from "@/lib/fechas";
import { leerAjustesVisitas } from "@/lib/visitas/ajustes";
import { identidadDeLecturas } from "@/lib/monitor/identidad";

export const dynamic = "force-dynamic";

/** Cuántos días hacia atrás mira la franja de la rutina en la ficha (los mismos que el perfil por defecto). */
const FRANJA_DIAS = 30;
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
        include: INCLUIR_LECTURA,
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

    const [perfil, reg, franjaFilas] = chapa ? await Promise.all([
        prisma.perfilMatricula.findUnique({ where: { plate: chapa } }).catch(() => null),
        registradas([chapa]),
        // Cuándo se la ve: lecturas de los últimos FRANJA_DIAS días por día de la semana y hora
        // del barrio. Es lo que dibuja la rutina en la ficha (7 × 24), con datos y no con el resumen.
        prisma.$queryRaw<{ dow: number; h: number; n: number }[]>`
            SELECT extract(isodow FROM (timestamp AT TIME ZONE 'UTC' AT TIME ZONE ${ZONA}))::int AS dow,
                   extract(hour FROM (timestamp AT TIME ZONE 'UTC' AT TIME ZONE ${ZONA}))::int AS h, count(*)::int AS n
              FROM "AccessEvent"
             WHERE "plateDetected" = ${chapa} AND timestamp >= now() - (${String(FRANJA_DIAS)} || ' days')::interval
             GROUP BY 1, 2`.catch(() => []),
    ]) : [null, new Map(), []];
    const franja = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
    for (const f of franjaFilas as any[]) if (f.dow >= 1 && f.dow <= 7 && f.h >= 0 && f.h < 24) franja[f.dow - 1][f.h] = f.n;
    return NextResponse.json({
        lectura: { ...formaLectura(e), registrada: !!(chapa && reg.has(chapa)), ...((await identidadDeLecturas([e as any]).catch(() => new Map())).get(e.id) || {}) },
        registradaPor: chapa ? reg.get(chapa) || null : null,
        perfil: perfil ? {
            clase: perfil.clase, diasVistos: perfil.diasVistos, entradas: perfil.entradas, salidas: perfil.salidas, primeraVez: perfil.primeraVez.toISOString(), ultimaVez: perfil.ultimaVez.toISOString(),
            permanenciaMedianaMin: perfil.permanenciaMedianaMin, permanenciaP90Min: perfil.permanenciaP90Min, visitasConSalida: perfil.visitasConSalida,
            entradaNoVista: perfil.entradaNoVista, rutina: perfil.rutina, actualizado: perfil.actualizado.toISOString(),
        } : null,
        franja, franjaDias: FRANJA_DIAS,
        visita: chapa ? await prisma.visita.findFirst({ where: { plate: chapa, sale: null }, select: { id: true, tipo: true, loteNombre: true, entra: true, vence: true, origen: true } })
            .then(async (v) => v ? { ...v, tipo: (await leerAjustesVisitas()).tipos.find((t) => t.clave === v.tipo)?.nombre || v.tipo } : null).catch(() => null) : null,
        persona: duenio ? { nombre: duenio.name, rol: duenio.role, unidad: duenio.unit?.name || null } : null,
        vehiculo: vehiculo ? { marca: vehiculo.brand, modelo: vehiculo.model, color: vehiculo.color, tipo: vehiculo.type } : null,
        vigilancia: vigilancia ? { categoria: vigilancia.category, motivo: vigilancia.motivo || vigilancia.label || null } : null,
        invitado: invitado ? { nombre: invitado.guest.name || null, anfitrion: invitado.guest.invitation.hostName || null, lote: invitado.guest.invitation.hostLabel || null, desde: invitado.guest.invitation.validFrom.toISOString(), hasta: invitado.guest.invitation.validTo.toISOString() } : null,
        hoy: (pasos as any[]).map((x) => ({ id: x.id, ts: x.timestamp.toISOString(), sentido: x.direction, decision: x.decision, camara: x.device?.name || null })),
        adentroDesde: ultimaPermitida?.direction === "ENTRY" ? ultimaPermitida.timestamp.toISOString() : null,
    }, { headers: SIN_CACHE });
}
