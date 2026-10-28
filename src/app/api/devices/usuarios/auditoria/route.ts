/**
 * GET /api/devices/usuarios/auditoria — lo que quedó en Auditoría sobre cuentas y sesiones de los
 * equipos: cuentas nuevas o que se fueron, sesiones desde IP desconocidas y quién marcó qué como
 * conocido (openspec usuarios-de-equipos, «Auditoría del área»). `deviceId` (varios, con coma) acota a
 * esos equipos; sin él, todo el sitio, incluidas las IP marcadas. `dias` (por defecto 30). Pide `dispositivos`.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirFuncion } from "@/lib/funcion-servidor";
import { rechazoPorPermiso } from "@/lib/permiso-servidor";
import { ACCIONES_DE_EQUIPOS, ACCION_EQUIPOS } from "@/lib/usuarios-equipo/acciones";

export const dynamic = "force-dynamic";
const TOPE = 300, DIAS_POR_DEFECTO = 30, DIAS_MAX = 365;

export async function GET(req: NextRequest) {
    const apagada = await exigirFuncion("EQUIPOS_USUARIOS"); if (apagada) return apagada;
    const no = await rechazoPorPermiso("dispositivos", "auditoría de cuentas"); if (no) return no;
    const q = req.nextUrl.searchParams;
    const ids = (q.get("deviceId") || "").split(",").map((x) => x.trim()).filter(Boolean);
    const dias = Math.min(DIAS_MAX, Math.max(1, Number(q.get("dias")) || DIAS_POR_DEFECTO));
    const desde = new Date(Date.now() - dias * 86_400_000);
    // AccionSistema guarda el nombre del equipo en `objetivo`: se filtra por los nombres de esos equipos.
    const nombres = ids.length ? (await prisma.device.findMany({ where: { id: { in: ids } }, select: { name: true } })).map((d) => d.name) : null;
    const deIp = [ACCION_EQUIPOS.IP_CONOCIDA, ACCION_EQUIPOS.IP_NO_CONOCIDA] as string[];
    const filas = await prisma.accionSistema.findMany({
        where: {
            cuando: { gte: desde },
            accion: { in: nombres ? ACCIONES_DE_EQUIPOS.filter((a) => !deIp.includes(a)) : ACCIONES_DE_EQUIPOS },
            ...(nombres ? { objetivo: { in: nombres } } : {}),
        },
        orderBy: { cuando: "desc" }, take: TOPE,
    });
    return NextResponse.json({ ok: true, dias, filas: filas.map((f) => ({ id: f.id, cuando: f.cuando.toISOString(), quien: f.quien, accion: f.accion, objetivo: f.objetivo, detalle: f.detalle })) }, { headers: { "Cache-Control": "no-store" } });
}
