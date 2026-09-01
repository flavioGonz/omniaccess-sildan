import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendTelegramMessage } from "@/lib/telegram";

/**
 * GET /api/queue/report/send?period=daily|weekly[&deviceId=]
 * Computes an aforo summary for the period and sends it to Telegram.
 * Intended to be triggered by a system cron (e.g. daily at 20:00).
 */
export async function GET(req: NextRequest) {
    try {
        const period = (req.nextUrl.searchParams.get("period") || "daily").toLowerCase();
        const deviceId = req.nextUrl.searchParams.get("deviceId") || undefined;

        const now = new Date();
        const from = new Date(now);
        if (period === "weekly") from.setDate(from.getDate() - 7);
        from.setHours(0, 0, 0, 0);

        const where: any = { timestamp: { gte: from, lte: now }, channelName: "Aforo" };
        if (deviceId) where.deviceId = deviceId;

        const events = await prisma.queueEvent.findMany({
            where,
            select: { peopleCount: true, timestamp: true, device: { select: { name: true } } },
            orderBy: { timestamp: "asc" },
        });

        const counts = events.map(e => e.peopleCount);
        const max = counts.length ? Math.max(...counts) : 0;
        const avg = counts.length ? Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 10) / 10 : 0;

        // Peak hour
        const byHour = new Map<number, number>();
        for (const e of events) {
            const h = new Date(e.timestamp).getHours();
            byHour.set(h, Math.max(byHour.get(h) || 0, e.peopleCount));
        }
        let peakHour = -1, peakHourVal = -1;
        for (const [h, v] of byHour) if (v > peakHourVal) { peakHourVal = v; peakHour = h; }

        // Horas críticas: top 3 horas por pico de aforo
        const criticalHours = Array.from(byHour.entries())
            .filter(([, v]) => v > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([h, v]) => `${String(h).padStart(2, "0")}:00 (${v})`);

        // Alerts fired in period
        const alertsFired = await prisma.notificationLog.count({
            where: { createdAt: { gte: from, lte: now } },
        }).catch(() => 0);

        // Camera outages in period
        const outageWhere: any = { startedAt: { gte: from, lte: now } };
        if (deviceId) outageWhere.deviceId = deviceId;
        const outages = await prisma.cameraOutage.findMany({ where: outageWhere }).catch(() => [] as any[]);
        const outageCount = outages.length;
        const outageSecs = outages.reduce((a: number, o: any) => a + (o.durationSec ?? (o.endedAt ? Math.round((new Date(o.endedAt).getTime() - new Date(o.startedAt).getTime())/1000) : Math.round((Date.now()-new Date(o.startedAt).getTime())/1000))), 0);
        const fmtDur = (sec: number) => {
            if (sec < 60) return `${sec}s`;
            const m = Math.floor(sec/60); if (m < 60) return `${m}m`;
            const h = Math.floor(m/60); return `${h}h ${m%60}m`;
        };

        const deviceName = events[0]?.device?.name || "Aforo";
        const label = period === "weekly" ? "Semanal (últimos 7 días)" : "Diario";
        const dateStr = now.toLocaleDateString("es-UY", { day: "2-digit", month: "long", year: "numeric" });

        const msg =
            `📊 <b>Reporte de Aforo — ${label}</b>\n` +
            `📍 ${deviceName}\n` +
            `🗓 ${dateStr}\n\n` +
            `👥 Pico de aforo: <b>${max}</b> personas` + (peakHour >= 0 ? ` (a las ${String(peakHour).padStart(2, "0")}:00)` : "") + `\n` +
            `📈 Promedio: <b>${avg}</b> personas\n` +
            `🔔 Alertas emitidas: <b>${alertsFired}</b>\n` +
            `📦 Lecturas registradas: ${counts.length}\n` +
            `📷 Cortes de cámara: <b>${outageCount}</b>` + (outageCount ? ` (sin servicio ${fmtDur(outageSecs)})` : "") + `\n` +
            (criticalHours.length ? `⏰ Horas críticas: <b>${criticalHours.join(" · ")}</b>\n\n` : `\n`) +
            `<i>OmniAccess · Control de Filas</i>`;

        const sent = await sendTelegramMessage(msg);

        return NextResponse.json({
            status: sent ? "ok" : "failed",
            period, summary: { max, avg, peakHour, alertsFired, readings: counts.length, outages: outageCount, outageSecs, criticalHours },
            sent,
        });
    } catch (e: any) {
        return NextResponse.json({ status: "error", message: e.message }, { status: 500 });
    }
}
