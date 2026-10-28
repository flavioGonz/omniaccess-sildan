/**
 * POST /api/devices/usuarios/revisar — «Revisar» del panel de un área (openspec usuarios-de-equipos):
 * lee ahora las cuentas y las sesiones de esos equipos, sin esperar la vuelta de cada hora.
 *   { deviceIds: string[] }
 * Sólo hace GET a los equipos; pide `dispositivos.usuarios` porque dispara pedidos a muchos a la vez.
 */
import { NextRequest, NextResponse } from "next/server";
import { exigirFuncion } from "@/lib/funcion-servidor";
import { rechazoPorPermiso } from "@/lib/permiso-servidor";
import { vueltaUsuarios } from "@/lib/usuarios-equipo/lectura";

export const dynamic = "force-dynamic";
/** Tope de equipos por pedido: un área grande se lee igual en la vuelta automática. */
const MAX_EQUIPOS = 200;

export async function POST(req: NextRequest) {
    const apagada = await exigirFuncion("EQUIPOS_USUARIOS"); if (apagada) return apagada;
    const no = await rechazoPorPermiso("dispositivos.usuarios", "revisar las cuentas"); if (no) return no;
    const b = await req.json().catch(() => ({}));
    const ids = Array.isArray(b.deviceIds) ? [...new Set(b.deviceIds.map(String))].slice(0, MAX_EQUIPOS) as string[] : [];
    if (!ids.length) return NextResponse.json({ ok: false, error: "No hay equipos para revisar" }, { status: 400 });
    const r = await vueltaUsuarios({ soloEquipos: ids, forzarCuentas: true });
    return NextResponse.json({ ok: true, ...r });
}
