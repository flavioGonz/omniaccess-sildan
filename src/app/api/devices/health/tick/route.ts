/**
 * GET /api/devices/health/tick — llamado por cron cada minuto (exento de auth en middleware).
 * Sondea todos los equipos, persiste una muestra y evalúa/dispara alertas (Telegram).
 */
import { NextResponse } from "next/server";
import { probeAllDevices, persistAndAlert } from "@/lib/device-health";
import { conRegistro } from "@/lib/tareas/ejecucion";

export const dynamic = "force-dynamic";

async function ejecutar() {
    try {
        const results = await probeAllDevices();
        await persistAndAlert(results);
        return NextResponse.json({ ok: true, n: results.length, ts: Date.now() });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "tick error" }, { status: 500 });
    }
}

/** Cada corrida queda registrada y la tarea se puede pausar desde Ajustes → Procesos y tareas. */
export const GET = conRegistro("salud-equipos", ejecutar);
