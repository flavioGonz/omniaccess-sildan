/**
 * GET /api/devices/usuarios/tick — la lectura de cuentas y sesiones de los equipos (openspec
 * usuarios-de-equipos). La llama el cron cada 5 minutos; exenta de sesión en el middleware, como la
 * salud. Con la función «Usuarios de los equipos» apagada responde 404 y no le pide nada a ningún equipo.
 */
import { NextResponse } from "next/server";
import { conRegistro } from "@/lib/tareas/ejecucion";
import { exigirFuncion } from "@/lib/funcion-servidor";
import { vueltaUsuarios } from "@/lib/usuarios-equipo/lectura";

export const dynamic = "force-dynamic";

async function ejecutar() {
    const apagada = await exigirFuncion("EQUIPOS_USUARIOS"); if (apagada) return apagada;
    try {
        const r = await vueltaUsuarios();
        console.log(`[usuarios-equipos] ${r.equipos} equipos (${r.conCuentas} con cuentas) en ${r.ms} ms · ${r.errores} con error · ${r.avisos} avisos nuevos`);
        return NextResponse.json({ ok: true, ...r });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "error en la lectura" }, { status: 500 });
    }
}

export const GET = conRegistro("usuarios-equipos", ejecutar);
