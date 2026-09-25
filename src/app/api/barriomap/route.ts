import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/barriomap  → devuelve el mapa (mismo shape que getBarrioMap)
export async function GET() {
    try {
        const row = await prisma.setting.findUnique({ where: { key: "BARRIO_MAP" } });
        const d = row?.value ? JSON.parse(row.value) : {};
        return NextResponse.json({
            center: Array.isArray(d.center) ? d.center : [-34.9011, -56.1645],
            zoom: typeof d.zoom === "number" ? d.zoom : 16,
            perimeter: Array.isArray(d.perimeter) ? d.perimeter : [],
            streets: Array.isArray(d.streets) ? d.streets : [],
            cameras: Array.isArray(d.cameras) ? d.cameras : [],
            lotes: Array.isArray(d.lotes) ? d.lotes : [],
            divisions: Array.isArray(d.divisions) ? d.divisions : [],
        });
    } catch (e: any) {
        return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
    }
}

// POST /api/barriomap  → guarda el mapa completo (incluye lotes + parkingSlotId)
export async function POST(req: NextRequest) {
    try {
        const data = await req.json();
        if (!data || typeof data !== "object") {
            return NextResponse.json({ ok: false, error: "payload inválido" }, { status: 400 });
        }
        const clean = {
            center: Array.isArray(data.center) ? data.center : [-34.9011, -56.1645],
            zoom: typeof data.zoom === "number" ? data.zoom : 16,
            perimeter: Array.isArray(data.perimeter) ? data.perimeter : [],
            streets: Array.isArray(data.streets) ? data.streets : [],
            cameras: Array.isArray(data.cameras) ? data.cameras : [],
            lotes: Array.isArray(data.lotes) ? data.lotes : [],
            divisions: Array.isArray(data.divisions) ? data.divisions : [],
        };
        await prisma.setting.upsert({
            where: { key: "BARRIO_MAP" },
            update: { value: JSON.stringify(clean) },
            create: { key: "BARRIO_MAP", value: JSON.stringify(clean) },
        });
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        console.error("[api/barriomap POST] fallo:", e);
        return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
    }
}
