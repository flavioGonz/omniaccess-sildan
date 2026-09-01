import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resetQueueCounters } from "@/lib/onvif-polling";

// GET /api/queue/schedule/tick → checks schedules; at openTime (today) triggers counter reset.
export async function GET(_req: NextRequest) {
    try {
        const now = new Date();
        // El servidor corre en UTC; los horarios los carga el usuario en hora de Montevideo (UTC-3).
        const UY = new Date(now.getTime() - 3 * 60 * 60 * 1000);
        const dow = UY.getUTCDay() === 0 ? 7 : UY.getUTCDay(); // 1=Mon..7=Sun (hora local)
        const hhmm = `${String(UY.getUTCHours()).padStart(2, "0")}:${String(UY.getUTCMinutes()).padStart(2, "0")}`;

        const schedules = await prisma.queueSchedule.findMany({ where: { enabled: true, resetOnOpen: true } });
        const fired: string[] = [];

        for (const s of schedules) {
            const days = (s.daysOfWeek || "").split(",").map(x => parseInt(x.trim(), 10));
            if (!days.includes(dow)) continue;
            if (s.openTime !== hhmm) continue;
            // avoid double-fire within the same minute
            if (s.lastResetAt && (now.getTime() - new Date(s.lastResetAt).getTime()) < 90 * 1000) continue;

            const devices = s.deviceId
                ? await prisma.device.findMany({ where: { id: s.deviceId }, select: { id: true } })
                : await prisma.device.findMany({ where: { deviceType: "QUEUE_COUNTER" }, select: { id: true } });
            for (const d of devices) {
                try { resetQueueCounters(d.id); } catch {}
                for (const ch of ["Aforo", "Entrada", "Salida"]) {
                    await prisma.queueEvent.create({
                        data: { deviceId: d.id, channelName: ch, channelId: 1, peopleCount: 0, timestamp: now, metadata: JSON.stringify({ source: "schedule_open", schedule: s.name }) },
                    });
                }
            }
            await prisma.queueSchedule.update({ where: { id: s.id }, data: { lastResetAt: now } });
            fired.push(s.name);
        }
        return NextResponse.json({ status: "ok", time: hhmm, dow, fired });
    } catch (e: any) {
        return NextResponse.json({ status: "error", message: e.message }, { status: 500 });
    }
}
