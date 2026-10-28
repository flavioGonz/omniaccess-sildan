/**
 * GET /api/devices/usuarios/sesiones — la historia de sesiones (quién entró a qué equipo y desde dónde).
 * Filtros: deviceId (uno o varios, separados por coma), nombre, ip, procedencia, abiertas=1, desde y hasta (ISO).
 * Pide `dispositivos`. Tope de filas: lo que entra en una tabla sin paginar.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirFuncion } from "@/lib/funcion-servidor";
import { rechazoPorPermiso } from "@/lib/permiso-servidor";
import { sesionVista } from "@/lib/usuarios-equipo/vista";

export const dynamic = "force-dynamic";
const TOPE = 500;

export async function GET(req: NextRequest) {
    const apagada = await exigirFuncion("EQUIPOS_USUARIOS"); if (apagada) return apagada;
    const no = await rechazoPorPermiso("dispositivos", "sesiones de los equipos"); if (no) return no;
    const q = req.nextUrl.searchParams;
    const ids = (q.get("deviceId") || "").split(",").map((x) => x.trim()).filter(Boolean);
    const desde = q.get("desde") ? new Date(q.get("desde")!) : null, hasta = q.get("hasta") ? new Date(q.get("hasta")!) : null;
    const where: any = {
        ...(ids.length ? { deviceId: { in: ids } } : {}),
        ...(q.get("nombre") ? { nombre: { contains: q.get("nombre")!, mode: "insensitive" } } : {}),
        ...(q.get("ip") ? { ip: { contains: q.get("ip")! } } : {}),
        ...(q.get("procedencia") ? { procedencia: q.get("procedencia")! } : {}),
        ...(q.get("abiertas") === "1" ? { hasta: null } : {}),
        // Una sesión cae en el período si se la vio en algún momento dentro de él.
        ...(desde && !isNaN(+desde) ? { vistaUltima: { gte: desde } } : {}),
        ...(hasta && !isNaN(+hasta) ? { vistaPrimera: { lte: hasta } } : {}),
    };
    const filas = await prisma.sesionEquipo.findMany({ where, orderBy: { vistaPrimera: "desc" }, take: TOPE + 1 });
    return NextResponse.json({ ok: true, sesiones: filas.slice(0, TOPE).map(sesionVista), recortado: filas.length > TOPE }, { headers: { "Cache-Control": "no-store" } });
}
