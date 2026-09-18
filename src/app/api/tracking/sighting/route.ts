import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/tracking/sighting
 * Lo usa la pasarela de camaras comunes: manda la lectura ya resuelta por
 * Omni-LPR y aca solo se normaliza y se guarda. Protegido con un token propio
 * (TRACKING_TOKEN en Settings o en el entorno), porque no lleva sesion.
 */
export async function POST(req: NextRequest) {
    const token = req.headers.get("x-tracking-token") || "";
    let esperado = process.env.TRACKING_TOKEN || "";
    if (!esperado) {
        const s = await prisma.setting.findUnique({ where: { key: "TRACKING_TOKEN" } });
        esperado = s?.value || "";
    }
    if (!esperado || token !== esperado) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    let body: any = {};
    try { body = await req.json(); } catch { }

    const patente = String(body.plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (patente.length < 4) return NextResponse.json({ error: "Matrícula inválida" }, { status: 400 });

    const confianza = body.confidence != null ? Number(body.confidence) : null;
    const minimo = Number(process.env.TRACKING_MIN_CONFIDENCE || 0.6);
    if (confianza != null && confianza < minimo) {
        return NextResponse.json({ ok: true, ignorado: "confianza baja", confianza }, { status: 202 });
    }

    const cuando = body.timestamp ? new Date(body.timestamp) : new Date();

    // Antirrebote: la misma patente en la misma camara dentro de la ventana no
    // genera un punto nuevo (una camara comun dispara muchos frames seguidos).
    const ventanaSeg = Number(process.env.TRACKING_DEDUPE_SECONDS || 45);
    const reciente = await prisma.plateSighting.findFirst({
        where: {
            plate: patente,
            deviceId: body.deviceId || null,
            timestamp: { gte: new Date(cuando.getTime() - ventanaSeg * 1000), lte: cuando },
        },
        orderBy: { timestamp: "desc" },
    });
    if (reciente) {
        return NextResponse.json({ ok: true, ignorado: "repetido", id: reciente.id }, { status: 202 });
    }

    let { lat, lng } = body;
    if ((lat == null || lng == null) && body.deviceId) {
        const row = await prisma.setting.findUnique({ where: { key: "BARRIO_MAP" } });
        try {
            const cam = (JSON.parse(row?.value || "{}").cameras || []).find((c: any) => c.deviceId === body.deviceId);
            if (cam) { lat = cam.lat; lng = cam.lng; }
        } catch { }
    }

    const creado = await prisma.plateSighting.create({
        data: {
            plate: patente,
            deviceId: body.deviceId || null,
            cameraName: body.cameraName || null,
            lat: lat ?? null,
            lng: lng ?? null,
            timestamp: cuando,
            source: "TRACK",
            eventType: body.eventType || "INTERNAL",
            decision: null,
            confidence: confianza,
            snapshotUrl: body.snapshotUrl || null,
        },
    });

    return NextResponse.json({ ok: true, id: creado.id });
}
