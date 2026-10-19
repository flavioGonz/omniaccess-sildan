import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resetQueueCounters } from "@/lib/onvif-polling";
import { conRegistro } from "@/lib/tareas/ejecucion";
import { enMontevideo, especialDe, diasDe } from "@/lib/filas/horario";

// GET /api/queue/schedule/tick → checks schedules; at openTime (today) triggers counter reset.
async function ejecutar(_req: NextRequest) {
    try {
        const now = new Date();
        // Hora de Montevideo calculada a mano (lib/filas/horario): no depende de la zona del servidor.
        const { fecha, dow, hhmm } = enMontevideo(now);

        const schedules = await prisma.queueSchedule.findMany({ where: { enabled: true, resetOnOpen: true } });
        // Un día especial (feriado: no abre; horario reducido: abre a otra hora) manda sobre el de siempre.
        const especiales = await prisma.queueDiaEspecial.findMany({ where: { fecha } });
        const fired: string[] = [];

        for (const s of schedules) {
            // avoid double-fire within the same minute
            if (s.lastResetAt && (now.getTime() - new Date(s.lastResetAt).getTime()) < 90 * 1000) continue;

            const devices = s.deviceId
                ? await prisma.device.findMany({ where: { id: s.deviceId }, select: { id: true } })
                : await prisma.device.findMany({ where: { deviceType: "QUEUE_COUNTER" }, select: { id: true } });
            let alguno = false;
            for (const d of devices) {
                const esp = especialDe(especiales, d.id, fecha);
                const abreHoy = esp ? (esp.cerrada ? null : esp.openTime) : (diasDe(s.daysOfWeek).includes(dow) ? s.openTime : null);
                if (abreHoy !== hhmm) continue;
                alguno = true;
                try { resetQueueCounters(d.id); } catch {}
                for (const ch of ["Aforo", "Entrada", "Salida"]) {
                    await prisma.queueEvent.create({
                        data: { deviceId: d.id, channelName: ch, channelId: 1, peopleCount: 0, timestamp: now, metadata: JSON.stringify({ source: "schedule_open", schedule: s.name, especial: !!esp }) },
                    });
                }
            }
            if (!alguno) continue;
            await prisma.queueSchedule.update({ where: { id: s.id }, data: { lastResetAt: now } });
            fired.push(s.name);
        }
        return NextResponse.json({ status: "ok", time: hhmm, dow, fired });
    } catch (e: any) {
        return NextResponse.json({ status: "error", message: e.message }, { status: 500 });
    }
}

/** Cada corrida queda registrada y la tarea se puede pausar desde Ajustes → Procesos y tareas. */
export const GET = conRegistro("horarios-filas", ejecutar);
