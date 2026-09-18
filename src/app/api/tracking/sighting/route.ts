import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Dos avistamientos de la misma matricula separados por menos que esto son el mismo
// paso por el barrio. Mas que esto, el auto se fue y volvio: es otro trayecto.
const VENTANA_TRAYECTO_MIN = Number(process.env.TRACKING_PASS_WINDOW_MIN || 10);

/**
 * POST /api/tracking/sighting
 * Lo usa la pasarela de camaras comunes: manda la lectura ya consolidada por la
 * rafaga y aca solo se normaliza, se guarda y se engancha al trayecto que
 * corresponda. Protegido con un token propio (TRACKING_TOKEN en Settings o en el
 * entorno), porque no lleva sesion.
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
    const lecturas = body.reads != null ? Number(body.reads) : null;

    // Antirrebote. La pasarela ya consolida cada paso en una sola lectura, asi que
    // esto es la segunda red: cubre el caso de dos rafagas encadenadas y el de una
    // instalacion vieja que todavia mande un aviso por cuadro.
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
        // Si la nueva viene mejor respaldada, se queda con la mejor foto y confianza
        // en vez de tirarla: es informacion del mismo paso, no ruido.
        if (confianza != null && (reciente.confidence ?? 0) < confianza) {
            await prisma.plateSighting.update({
                where: { id: reciente.id },
                data: {
                    confidence: confianza,
                    reads: lecturas ?? reciente.reads,
                    snapshotUrl: body.snapshotUrl || reciente.snapshotUrl,
                },
            }).catch(() => { });
        }
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

    // ── Trayecto: se engancha al ultimo paso abierto de esa matricula, o se abre uno.
    const desde = new Date(cuando.getTime() - VENTANA_TRAYECTO_MIN * 60 * 1000);
    let pass = await prisma.vehiclePass.findFirst({
        where: { plate: patente, endedAt: { gte: desde } },
        orderBy: { endedAt: "desc" },
    });
    if (pass) {
        if (cuando > pass.endedAt) {
            await prisma.vehiclePass.update({ where: { id: pass.id }, data: { endedAt: cuando } });
        }
    } else {
        pass = await prisma.vehiclePass.create({
            data: { plate: patente, startedAt: cuando, endedAt: cuando },
        });
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
            reads: lecturas,
            snapshotUrl: body.snapshotUrl || null,
            passId: pass.id,
        },
    });

    return NextResponse.json({ ok: true, id: creado.id, passId: pass.id });
}
