import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueueDispatch } from "@/lib/dispatch-queue";

/**
 * GET /api/queue/report/tick
 * Llamado cada minuto por cron. Revisa los ReportSchedule habilitados y, si
 * alguno coincide con la hora (y día, si es semanal), encola un reporte.
 * Dedupe: no vuelve a disparar el mismo schedule dentro de ~90s.
 */
export async function GET() {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const isoDay = now.getDay() === 0 ? 7 : now.getDay();

    let schedules: any[] = [];
    try { schedules = await prisma.reportSchedule.findMany({ where: { enabled: true } }); }
    catch { return NextResponse.json({ ok: false, error: "no schedules" }); }

    const fired: string[] = [];
    for (const s of schedules) {
        if (s.time !== hhmm) continue;
        if (s.frequency === "weekly" && s.dayOfWeek !== isoDay) continue;
        if (s.lastRunAt && (now.getTime() - new Date(s.lastRunAt).getTime()) < 90 * 1000) continue;
        try {
            await prisma.reportSchedule.update({ where: { id: s.id }, data: { lastRunAt: now } });
            await enqueueDispatch({
                type: "REPORT", channel: s.channel, deviceId: s.deviceId,
                payload: { period: s.period, deviceId: s.deviceId, scheduleName: s.name },
                maxAttempts: 3,
            });
            fired.push(s.id);
        } catch (e: any) { console.error(`[report-tick] ${s.name}: ${e.message}`); }
    }
    return NextResponse.json({ ok: true, hhmm, isoDay, fired });
}
