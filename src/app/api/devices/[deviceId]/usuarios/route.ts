/**
 * GET /api/devices/<id>/usuarios — las cuentas locales de un equipo, sus sesiones abiertas y la última
 * lectura (openspec usuarios-de-equipos). `?leer=1` lo lee en el momento (sólo GET al equipo).
 * Pide el permiso `dispositivos` (ver); escribir cuentas es otra ruta, con `dispositivos.usuarios`.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirFuncion } from "@/lib/funcion-servidor";
import { rechazoPorPermiso } from "@/lib/permiso-servidor";
import { compatible, vueltaUsuarios } from "@/lib/usuarios-equipo/lectura";
import { cuentaVista, sesionVista, lecturaVista, equipoVista } from "@/lib/usuarios-equipo/vista";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ deviceId: string }> }) {
    const apagada = await exigirFuncion("EQUIPOS_USUARIOS"); if (apagada) return apagada;
    const no = await rechazoPorPermiso("dispositivos", "usuarios del equipo"); if (no) return no;
    const { deviceId } = await ctx.params;
    const d = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!d) return NextResponse.json({ ok: false, error: "No existe ese equipo" }, { status: 404 });
    if (req.nextUrl.searchParams.get("leer") === "1" && compatible(d)) await vueltaUsuarios({ soloEquipo: d.id });
    const [cuentas, sesiones, lectura] = await Promise.all([
        prisma.cuentaEquipo.findMany({ where: { deviceId: d.id }, orderBy: [{ desaparecida: "asc" }, { nombre: "asc" }] }),
        prisma.sesionEquipo.findMany({ where: { deviceId: d.id, hasta: null }, orderBy: { vistaPrimera: "desc" } }),
        prisma.lecturaUsuariosEquipo.findUnique({ where: { deviceId: d.id } }),
    ]);
    return NextResponse.json({
        ok: true, equipo: equipoVista(d), lectura: lecturaVista(lectura),
        cuentas: cuentas.map((c) => cuentaVista(c, d.username)), sesiones: sesiones.map(sesionVista),
    }, { headers: { "Cache-Control": "no-store" } });
}
