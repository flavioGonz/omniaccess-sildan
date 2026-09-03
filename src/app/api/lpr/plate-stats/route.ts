/** GET /api/lpr/plate-stats?plate=SCT4403&days=30
 *  Perfil de comportamiento de una matrícula: frecuencia por día, serie diaria, cámaras habituales
 *  (con desglose entrada/salida) y horarios típicos de entrada y salida. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const TZ = "America/Montevideo";
const fmtDay = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const fmtHour = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hour12: false });
const fmtWd = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" });
const localHour = (d: Date) => { const h = Number(fmtHour.format(d)); return h === 24 ? 0 : h; };

/** Ventana horaria "típica": ventana de 3h con más eventos (modo suavizado). */
function typicalWindow(hist: number[]): { from: number; to: number; count: number; share: number } | null {
    const total = hist.reduce((a, b) => a + b, 0);
    if (!total) return null;
    let best = -1, bestI = 0;
    for (let i = 0; i < 24; i++) {
        const s = hist[i] + hist[(i + 1) % 24] + hist[(i + 2) % 24];
        if (s > best) { best = s; bestI = i; }
    }
    return { from: bestI, to: (bestI + 3) % 24, count: best, share: Math.round((best / total) * 100) };
}

export async function GET(req: NextRequest) {
    const plate = (req.nextUrl.searchParams.get("plate") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const days = Math.min(365, Math.max(1, parseInt(req.nextUrl.searchParams.get("days") || "30", 10)));
    if (!plate) return NextResponse.json({ ok: false, error: "plate requerido" }, { status: 400 });

    const since = new Date(Date.now() - days * 86400000);
    const events = await prisma.accessEvent.findMany({
        where: { plateDetected: { equals: plate, mode: "insensitive" }, timestamp: { gte: since } },
        select: { id: true, timestamp: true, direction: true, decision: true, deviceId: true, device: { select: { id: true, name: true, direction: true } } },
        orderBy: { timestamp: "desc" },
        take: 5000,
    });
    const firstEver = await prisma.accessEvent.findFirst({ where: { plateDetected: { equals: plate, mode: "insensitive" } }, orderBy: { timestamp: "asc" }, select: { timestamp: true } });

    // serie diaria (últimos `days` días, incluyendo días en cero)
    const byDay = new Map<string, number>();
    for (let i = days - 1; i >= 0; i--) byDay.set(fmtDay.format(new Date(Date.now() - i * 86400000)), 0);
    const cams = new Map<string, { deviceId: string | null; name: string; total: number; entry: number; exit: number; last: string }>();
    const hEntry = new Array(24).fill(0), hExit = new Array(24).fill(0), hAll = new Array(24).fill(0);
    const wd: Record<string, number> = {};
    let denied = 0;
    for (const e of events) {
        const d = new Date(e.timestamp);
        const day = fmtDay.format(d); if (byDay.has(day)) byDay.set(day, (byDay.get(day) || 0) + 1);
        const h = localHour(d);
        hAll[h]++; if (e.direction === "EXIT") hExit[h]++; else hEntry[h]++;
        const w = fmtWd.format(d); wd[w] = (wd[w] || 0) + 1;
        if (e.decision !== "GRANT") denied++;
        const key = e.deviceId || e.device?.name || "?";
        const c = cams.get(key) || { deviceId: e.deviceId, name: e.device?.name || "Cámara no identificada", total: 0, entry: 0, exit: 0, last: e.timestamp.toISOString() };
        c.total++; if (e.direction === "EXIT") c.exit++; else c.entry++;
        cams.set(key, c);
    }
    const daily = Array.from(byDay.entries()).map(([date, count]) => ({ date, count }));
    const activeDays = daily.filter(x => x.count > 0).length;
    const today = daily[daily.length - 1]?.count || 0;
    const total = events.length;
    const topCameras = Array.from(cams.values()).sort((a, b) => b.total - a.total).slice(0, 5).map(c => ({ ...c, pct: total ? Math.round((c.total / total) * 100) : 0 }));
    const days7 = daily.slice(-7).reduce((a, b) => a + b.count, 0);

    return NextResponse.json({
        ok: true, plate, days, total, today,
        perDay: Number((total / days).toFixed(2)),            // promedio sobre la ventana completa
        perActiveDay: activeDays ? Number((total / activeDays).toFixed(1)) : 0, // promedio sobre días con actividad
        activeDays, last7: days7, denied,
        firstSeen: firstEver?.timestamp || null, lastSeen: events[0]?.timestamp || null,
        daily, topCameras,
        hourly: { all: hAll, entry: hEntry, exit: hExit },
        typicalEntry: typicalWindow(hEntry), typicalExit: typicalWindow(hExit),
        weekdays: wd,
    }, { headers: { "Cache-Control": "no-store" } });
}
