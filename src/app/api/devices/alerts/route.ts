/** GET /api/devices/alerts — alertas activas (para el banner) */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const active = await prisma.deviceAlert.findMany({ where: { active: true }, orderBy: { openedAt: "desc" } });
        return NextResponse.json({ ok: true, active });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message, active: [] }, { status: 500 });
    }
}
