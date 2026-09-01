export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const clean = (p: string) => (p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// GET /api/history/merodeo -> { plates: string[] } (limpias) de Bitacora type=MERODEO (últimos 60 días)
export async function GET() {
    try {
        const since = new Date(Date.now() - 60 * 24 * 3600 * 1000);
        const rows = await prisma.bitacora.findMany({
            where: { type: "MERODEO", timestamp: { gte: since }, plate: { not: null } },
            select: { plate: true },
            take: 2000,
        });
        const set = new Set<string>();
        for (const r of rows) { const c = clean(r.plate || ""); if (c) set.add(c); }
        return NextResponse.json({ plates: Array.from(set) });
    } catch {
        return NextResponse.json({ plates: [] });
    }
}
