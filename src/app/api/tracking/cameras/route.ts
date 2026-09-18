import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Camaras de seguimiento: las camaras comunes (sin LPR propio) que la pasarela
 * muestrea y manda al contenedor Omni-LPR. Se guardan como JSON en el Setting
 * TRACK_CAMERAS; el worker relee esa clave cada 60 segundos, asi que un alta o
 * una baja se aplican solas, sin reiniciar nada.
 */

export type CamaraSeguimiento = {
    name: string;
    rtsp: string;
    deviceId?: string;
    lat?: number;
    lng?: number;
    escena?: number;
    activa?: boolean;
};

function sanear(lista: any): CamaraSeguimiento[] {
    if (!Array.isArray(lista)) return [];
    return lista
        .filter((c) => c && typeof c.name === "string" && typeof c.rtsp === "string" && c.name.trim() && c.rtsp.trim())
        .map((c) => ({
            name: String(c.name).trim().slice(0, 60),
            rtsp: String(c.rtsp).trim(),
            deviceId: c.deviceId ? String(c.deviceId) : undefined,
            lat: c.lat === "" || c.lat === null || c.lat === undefined ? undefined : Number(c.lat),
            lng: c.lng === "" || c.lng === null || c.lng === undefined ? undefined : Number(c.lng),
            escena: c.escena === "" || c.escena === null || c.escena === undefined ? undefined : Number(c.escena),
            activa: c.activa === false ? false : true,
        }))
        .filter((c) => !Number.isNaN(c.lat ?? 0) && !Number.isNaN(c.lng ?? 0));
}

/** Oculta la contrasena del RTSP para no exponerla en la pantalla. */
function enmascarar(rtsp: string) {
    return rtsp.replace(/:\/\/([^:/@]+):([^@]+)@/, "://$1:******@");
}

export async function GET() {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    let camaras: CamaraSeguimiento[] = [];
    try {
        const s = await prisma.setting.findUnique({ where: { key: "TRACK_CAMERAS" } });
        camaras = sanear(JSON.parse(s?.value || "[]"));
    } catch { }

    const parametros = {
        minConfidence: Number(process.env.TRACKING_MIN_CONFIDENCE || 0.6),
        dedupeSeconds: Number(process.env.TRACKING_DEDUPE_SECONDS || 45),
        lprUrl: process.env.OMNI_LPR_URL || "http://127.0.0.1:8000",
    };

    return NextResponse.json({
        camaras: camaras.map((c) => ({ ...c, rtspVisible: enmascarar(c.rtsp) })),
        parametros,
    });
}

export async function PUT(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.role !== "ADMIN") {
        return NextResponse.json({ error: "Solo un administrador puede cambiar las cámaras." }, { status: 403 });
    }

    try {
        const body = await req.json();
        const camaras = sanear(body?.camaras);
        await prisma.setting.upsert({
            where: { key: "TRACK_CAMERAS" },
            update: { value: JSON.stringify(camaras) },
            create: { key: "TRACK_CAMERAS", value: JSON.stringify(camaras) },
        });
        return NextResponse.json({ ok: true, total: camaras.length });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "No se pudo guardar" }, { status: 500 });
    }
}
