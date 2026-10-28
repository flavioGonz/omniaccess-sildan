/**
 * GET /api/devices/usuarios — las cuentas de todos los equipos (la vista «Todas» y el panel de un área
 * en Dispositivos). El filtro por área lo hace la pantalla, que ya tiene el árbol. Pide `dispositivos`.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirFuncion } from "@/lib/funcion-servidor";
import { rechazoPorPermiso } from "@/lib/permiso-servidor";
import { cuentaVista, lecturaVista, equipoVista } from "@/lib/usuarios-equipo/vista";
import { PREFIJOS_ALERTA } from "@/lib/usuarios-equipo/inventario";

export const dynamic = "force-dynamic";

export async function GET() {
    const apagada = await exigirFuncion("EQUIPOS_USUARIOS"); if (apagada) return apagada;
    const no = await rechazoPorPermiso("dispositivos", "usuarios de los equipos"); if (no) return no;
    const [equipos, cuentas, lecturas, abiertas, alertas] = await Promise.all([
        prisma.device.findMany({ orderBy: { name: "asc" } }),
        prisma.cuentaEquipo.findMany({ orderBy: { nombre: "asc" } }),
        prisma.lecturaUsuariosEquipo.findMany(),
        prisma.sesionEquipo.groupBy({ by: ["deviceId", "procedencia"], where: { hasta: null }, _count: { _all: true } }),
        prisma.deviceAlert.findMany({ where: { active: true, OR: PREFIJOS_ALERTA.map((p) => ({ type: { startsWith: p } })) }, select: { deviceId: true, type: true, message: true, openedAt: true } }),
    ]);
    const servicio = new Map(equipos.map((d) => [d.id, d.username]));
    const lect = new Map(lecturas.map((l) => [l.deviceId, l]));
    const sesiones: Record<string, Record<string, number>> = {};
    for (const s of abiertas) (sesiones[s.deviceId] ||= {})[s.procedencia] = s._count._all;
    return NextResponse.json({
        ok: true,
        equipos: equipos.map((d) => ({ ...equipoVista(d), lectura: lecturaVista(lect.get(d.id) || null), sesiones: sesiones[d.id] || {} })),
        cuentas: cuentas.map((c) => cuentaVista(c, servicio.get(c.deviceId) ?? null)),
        alertas: alertas.map((a) => ({ ...a, openedAt: a.openedAt.toISOString() })),
    }, { headers: { "Cache-Control": "no-store" } });
}
