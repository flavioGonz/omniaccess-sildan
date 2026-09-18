import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/** Calibración de una cámara interior: zona, sensibilidad, confianza y ritmo. */
export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    const id = req.nextUrl.searchParams.get("deviceId") || "";
    const d = await prisma.device.findUnique({
        where: { id },
        select: { id: true, name: true, rtspUrl: true, trackScene: true, trackRoi: true, trackLine: true, trackMinConf: true, trackFps: true, trackEnabled: true, trackTrigger: true },
    });
    if (!d) return NextResponse.json({ error: "No existe ese dispositivo." }, { status: 404 });

    let roi: any = null;
    try { roi = d.trackRoi ? JSON.parse(d.trackRoi) : null; } catch { }
    let linea: any = null;
    try { linea = d.trackLine ? JSON.parse(d.trackLine) : null; } catch { }

    return NextResponse.json({
        id: d.id,
        name: d.name,
        tieneRtsp: !!d.rtspUrl,
        escena: d.trackScene ?? 0.08,
        roi,
        linea,
        modo: (d.trackTrigger === "camara" ? "zona" : d.trackTrigger) || "escena",
        confianza: d.trackMinConf ?? Number(process.env.TRACKING_MIN_CONFIDENCE || 0.6),
        fps: d.trackFps ?? 2,
        activa: d.trackEnabled !== false,
    });
}

export async function PUT(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.role !== "ADMIN") {
        return NextResponse.json({ error: "Solo un administrador puede calibrar." }, { status: 403 });
    }

    const b = await req.json().catch(() => ({} as any));
    const id = String(b?.deviceId || "");
    if (!id) return NextResponse.json({ error: "Falta el dispositivo." }, { status: 400 });

    const lim = (v: any, min: number, max: number, def: number) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
    };

    let roi: string | null = null;
    const r = b?.roi;
    if (r && [r.x, r.y, r.w, r.h].every((v: any) => Number.isFinite(Number(v)))) {
        const limpio = {
            x: lim(r.x, 0, 1, 0), y: lim(r.y, 0, 1, 0),
            w: lim(r.w, 0.05, 1, 1), h: lim(r.h, 0.05, 1, 1),
        };
        // Zona completa = sin recorte, no vale la pena guardarla.
        const completa = limpio.x < 0.01 && limpio.y < 0.01 && limpio.w > 0.99 && limpio.h > 0.99;
        roi = completa ? null : JSON.stringify(limpio);
    }

    // La línea se guarda con el resto: dibujarla y apretar Guardar tiene que alcanzar.
    // Aplicarla en la cámara es otra cosa y la hace /api/tracking/camera-rule.
    let linea: string | null | undefined = undefined;
    const l = b?.linea;
    if (l === null) linea = null;
    else if (l && [l.x1, l.y1, l.x2, l.y2].every((v: any) => Number.isFinite(Number(v)))) {
        linea = JSON.stringify({
            x1: lim(l.x1, 0, 1, 0), y1: lim(l.y1, 0, 1, 0),
            x2: lim(l.x2, 0, 1, 1), y2: lim(l.y2, 0, 1, 1),
            sentido: ["any", "left-right", "right-left"].includes(l.sentido) ? l.sentido : "any",
        });
    }

    await prisma.device.update({
        where: { id },
        data: {
            ...(linea !== undefined ? { trackLine: linea } : {}),
            trackScene: lim(b?.escena, 0.01, 0.6, 0.08),
            trackMinConf: lim(b?.confianza, 0.1, 0.99, 0.6),
            trackFps: lim(b?.fps, 0.5, 10, 2),
            trackRoi: roi,
            ...(typeof b?.activa === "boolean" ? { trackEnabled: b.activa } : {}),
        },
    });

    return NextResponse.json({ ok: true });
}
