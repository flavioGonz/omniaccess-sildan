/**
 * POST /api/devices/usuarios/conocida — marcar (o desmarcar) como conocida una cuenta no gestionada o
 * una IP de origen (openspec usuarios-de-equipos). No toca ningún equipo: sólo cierra o reabre sus avisos.
 *   { tipo: "cuenta", cuentaId, conocida: true, motivo }
 *   { tipo: "ip", ip, nombre, motivo }   ·   { tipo: "ip", ip, quitar: true }
 * Pide `dispositivos.usuarios` y queda en Auditoría con quién y por qué.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirFuncion } from "@/lib/funcion-servidor";
import { rechazoPorPermiso } from "@/lib/permiso-servidor";
import { getSession } from "@/app/actions/auth";
import { ACCION_EQUIPOS } from "@/lib/usuarios-equipo/acciones";
import { alertaCuenta, alertaSesion } from "@/lib/usuarios-equipo/inventario";
import { leerIpsConocidas, guardarIpsConocidas, IP_VALIDA } from "@/lib/usuarios-equipo/conocidas";

export const dynamic = "force-dynamic";
const MAX_MOTIVO = 200;

export async function POST(req: NextRequest) {
    const apagada = await exigirFuncion("EQUIPOS_USUARIOS"); if (apagada) return apagada;
    const no = await rechazoPorPermiso("dispositivos.usuarios", "marcar conocida"); if (no) return no;
    const s: any = await getSession().catch(() => null);
    const quien = String(s?.name || s?.sub || "?").slice(0, 80);
    const b = await req.json().catch(() => ({}));
    const motivo = String(b.motivo || "").trim().slice(0, MAX_MOTIVO);

    if (b.tipo === "cuenta") {
        const c = await prisma.cuentaEquipo.findUnique({ where: { id: String(b.cuentaId || "") }, include: { device: { select: { name: true } } } });
        if (!c) return NextResponse.json({ ok: false, error: "No existe esa cuenta" }, { status: 404 });
        const conocida = !!b.conocida;
        if (conocida && !motivo) return NextResponse.json({ ok: false, error: "Escribí por qué es conocida: queda en Auditoría." }, { status: 400 });
        await prisma.cuentaEquipo.update({ where: { id: c.id }, data: conocida ? { conocida: true, conocidaMotivo: motivo, conocidaPor: quien } : { conocida: false, conocidaMotivo: null, conocidaPor: null } });
        if (conocida) await prisma.deviceAlert.updateMany({ where: { deviceId: c.deviceId, type: alertaCuenta(c.nombre), active: true }, data: { active: false, resolvedAt: new Date() } });
        // Al quitar la marca, la próxima lectura vuelve a abrir el aviso si sigue sin gestionar.
        await prisma.accionSistema.create({ data: { quien, accion: conocida ? ACCION_EQUIPOS.CUENTA_CONOCIDA : ACCION_EQUIPOS.CUENTA_NO_CONOCIDA, objetivo: c.device.name, ok: true, detalle: `${c.nombre}${motivo ? ` · ${motivo}` : ""}` } });
        return NextResponse.json({ ok: true });
    }

    if (b.tipo === "ip") {
        const ip = String(b.ip || "").trim();
        if (!IP_VALIDA.test(ip)) return NextResponse.json({ ok: false, error: "Esa IP no tiene una forma válida." }, { status: 400 });
        const lista = await leerIpsConocidas();
        if (b.quitar) {
            await guardarIpsConocidas(lista.filter((x) => x.ip !== ip));
            await prisma.accionSistema.create({ data: { quien, accion: ACCION_EQUIPOS.IP_NO_CONOCIDA, objetivo: ip, ok: true, detalle: null } });
            return NextResponse.json({ ok: true });
        }
        const nombre = String(b.nombre || "").trim().slice(0, 60);
        if (!nombre) return NextResponse.json({ ok: false, error: "Poné un nombre para esa IP (por ejemplo, «PC de la guardia»)." }, { status: 400 });
        await guardarIpsConocidas([...lista.filter((x) => x.ip !== ip), { ip, nombre, motivo: motivo || null, por: quien, cuando: new Date().toISOString() }]);
        // Las sesiones abiertas desde esa IP pasan a «conocida» y sus avisos se cierran.
        const abiertas = await prisma.sesionEquipo.findMany({ where: { ip, hasta: null, procedencia: "desconocida" }, select: { id: true, deviceId: true, nombre: true } });
        if (abiertas.length) await prisma.sesionEquipo.updateMany({ where: { id: { in: abiertas.map((a) => a.id) } }, data: { procedencia: "conocida", origenNombre: nombre } });
        for (const a of abiertas) await prisma.deviceAlert.updateMany({ where: { deviceId: a.deviceId, type: alertaSesion(a.nombre, ip), active: true }, data: { active: false, resolvedAt: new Date() } });
        await prisma.accionSistema.create({ data: { quien, accion: ACCION_EQUIPOS.IP_CONOCIDA, objetivo: ip, ok: true, detalle: `${nombre}${motivo ? ` · ${motivo}` : ""}` } });
        return NextResponse.json({ ok: true, sesiones: abiertas.length });
    }
    return NextResponse.json({ ok: false, error: "Pedido no válido" }, { status: 400 });
}

/** GET: la lista de IP conocidas (para la pantalla). Pide `dispositivos`. */
export async function GET() {
    const apagada = await exigirFuncion("EQUIPOS_USUARIOS"); if (apagada) return apagada;
    const no = await rechazoPorPermiso("dispositivos", "IP conocidas"); if (no) return no;
    return NextResponse.json({ ok: true, ips: await leerIpsConocidas() }, { headers: { "Cache-Control": "no-store" } });
}
