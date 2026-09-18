import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const CLAVE = "OMNI_LPR_ENABLED";

/** El reconocimiento por contenedor es opcional: este ajuste lo prende y apaga. */
export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    let activo = false;
    try {
        const s = await prisma.setting.findUnique({ where: { key: CLAVE } });
        activo = s?.value === "true";
    } catch { }

    let estado: any = null;
    if (activo) {
        let lpr = false;
        try {
            const url = (process.env.OMNI_LPR_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
            const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3000) });
            lpr = (await r.json())?.status === "ok";
        } catch { }

        let camaras = 0, lecturas24 = 0;
        try {
            camaras = await prisma.device.count({
                where: { deviceType: "LPR_INTERIOR" as any, trackEnabled: true, NOT: { rtspUrl: null } },
            });
            lecturas24 = await prisma.plateSighting.count({
                where: { source: "TRACK", timestamp: { gte: new Date(Date.now() - 86400000) } },
            });
        } catch { }
        estado = { lpr, camaras, lecturas24 };
    }

    return NextResponse.json({ activo, estado });
}

export async function PUT(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.role !== "ADMIN") {
        return NextResponse.json({ error: "Solo un administrador puede cambiar esto." }, { status: 403 });
    }

    const activo = (await req.json().catch(() => ({})))?.activo === true;
    await prisma.setting.upsert({
        where: { key: CLAVE },
        update: { value: activo ? "true" : "false" },
        create: { key: CLAVE, value: activo ? "true" : "false" },
    });
    return NextResponse.json({ ok: true, activo });
}
