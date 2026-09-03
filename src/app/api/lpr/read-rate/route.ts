/** GET /api/lpr/read-rate?days=7 — tasa de lectura ANPR (leídas vs NO_LEIDA) global, por cámara y por hora */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const days = Math.min(90, Math.max(1, parseInt(req.nextUrl.searchParams.get("days") || "7", 10)));
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    try {
        const perCameraRaw: any[] = await prisma.$queryRaw`
            SELECT e."deviceId" AS "deviceId", d."name" AS name, d."direction" AS direction,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE e."plateDetected" IS NOT NULL AND e."plateDetected" NOT IN ('NO_LEIDA','unknown','UNKNOWN','S/P',''))::int AS read
            FROM "AccessEvent" e LEFT JOIN "Device" d ON d."id" = e."deviceId"
            WHERE e."accessType" = 'PLATE' AND e."timestamp" >= ${since}
            GROUP BY e."deviceId", d."name", d."direction"
            ORDER BY total DESC`;
        const perHourRaw: any[] = await prisma.$queryRaw`
            SELECT EXTRACT(HOUR FROM (e."timestamp" AT TIME ZONE 'America/Montevideo'))::int AS hr,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE e."plateDetected" IS NOT NULL AND e."plateDetected" NOT IN ('NO_LEIDA','unknown','UNKNOWN','S/P',''))::int AS read
            FROM "AccessEvent" e
            WHERE e."accessType" = 'PLATE' AND e."timestamp" >= ${since}
            GROUP BY hr ORDER BY hr`;

        const perCamera = perCameraRaw.map((r) => {
            const total = Number(r.total), read = Number(r.read);
            return { deviceId: r.deviceId, name: r.name || "—", direction: r.direction, total, read, unread: total - read, ratePct: total ? Math.round((read / total) * 1000) / 10 : null };
        }).sort((a, b) => (a.ratePct ?? 101) - (b.ratePct ?? 101)); // peor primero

        const byHour: Record<number, { total: number; read: number }> = {};
        for (let h = 0; h < 24; h++) byHour[h] = { total: 0, read: 0 };
        for (const r of perHourRaw) { const h = Number(r.hr); byHour[h] = { total: Number(r.total), read: Number(r.read) }; }
        const perHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: byHour[h].total, read: byHour[h].read, ratePct: byHour[h].total ? Math.round((byHour[h].read / byHour[h].total) * 1000) / 10 : null }));

        const total = perCamera.reduce((s, c) => s + c.total, 0);
        const read = perCamera.reduce((s, c) => s + c.read, 0);
        const overall = { total, read, unread: total - read, ratePct: total ? Math.round((read / total) * 1000) / 10 : null };

        return NextResponse.json({ ok: true, days, overall, perCamera, perHour });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "read-rate error" }, { status: 500 });
    }
}
