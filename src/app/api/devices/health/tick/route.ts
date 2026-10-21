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
        // ¿Siguen llegando sus eventos? (lib/silencio). Cada 10 minutos alcanza.
        if (new Date().getMinutes() % 10 === 0) { const { evaluarSilencio } = await import("@/lib/silencio"); await evaluarSilencio().catch((e) => console.error("[silencio]", e?.message)); }
        // Diagnóstico de imagen (tapada, borrosa, movida): unas pocas cámaras por vuelta, cada una cada ~15 min.
        { const { vueltaDiagnostico } = await import("@/lib/diagnostico-imagen"); await vueltaDiagnostico().catch((e) => console.error("[diagnostico-imagen]", e?.message)); }
        return NextResponse.json({ ok: true, n: results.length, ts: Date.now() });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "tick error" }, { status: 500 });
    }
}

/** Cada corrida queda registrada y la tarea se puede pausar desde Ajustes → Procesos y tareas. */
export const GET = conRegistro("salud-equipos", ejecutar);
