import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Camaras interiores de seguimiento. Se dan de alta en Dispositivos LPR con el
 * tipo "Cámara Interior"; aca solo se listan para el panel de Omni-LPR, con la
 * ubicacion que tengan en el mapa del barrio.
 */

/** Oculta la contrasena del RTSP para no mostrarla en pantalla. */
function enmascarar(rtsp: string) {
    return rtsp.replace(/:\/\/([^:/@]+):([^@]+)@/, "://$1:******@");
}

export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    const devs = await prisma.device.findMany({
        where: { deviceType: "LPR_INTERIOR" as any },
        orderBy: { name: "asc" },
        select: { id: true, name: true, ip: true, location: true, rtspUrl: true, trackScene: true, trackEnabled: true },
    });

    let ubic: Record<string, { lat: number; lng: number }> = {};
    try {
        const row = await prisma.setting.findUnique({ where: { key: "BARRIO_MAP" } });
        const d = JSON.parse(row?.value || "{}");
        for (const c of d?.cameras || []) if (c?.deviceId) ubic[c.deviceId] = { lat: c.lat, lng: c.lng };
    } catch { }

    const camaras = devs.map((d) => ({
        id: d.id,
        name: d.name,
        ip: d.ip,
        location: d.location,
        rtsp: d.rtspUrl || "",
        rtspVisible: d.rtspUrl ? enmascarar(d.rtspUrl) : "",
        escena: d.trackScene ?? 0.08,
        activa: d.trackEnabled !== false,
        enMapa: !!ubic[d.id],
        lat: ubic[d.id]?.lat ?? null,
        lng: ubic[d.id]?.lng ?? null,
    }));

    return NextResponse.json({
        camaras,
        parametros: {
            minConfidence: Number(process.env.TRACKING_MIN_CONFIDENCE || 0.6),
            dedupeSeconds: Number(process.env.TRACKING_DEDUPE_SECONDS || 45),
            lprUrl: process.env.OMNI_LPR_URL || "http://127.0.0.1:8000",
        },
    });
}
