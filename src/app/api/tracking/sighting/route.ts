import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Dos avistamientos de la misma matrícula separados por menos que esto son el mismo paso
// por el barrio. Más que esto, el auto se fue y volvió: es otro trayecto.
const VENTANA_TRAYECTO_MIN = Number(process.env.TRACKING_PASS_WINDOW_MIN || 10);

// Cuánto se puede haber corrido el recuadro de la chapa entre dos lecturas para seguir
// considerando que el vehículo no se movió. Es fracción del cuadro: 3% de 1600 px son
// unos 48 px, más que suficiente para absorber el temblor del detector y bastante menos
// que lo que se desplaza un auto andando, aunque vaya despacio.
const TOLERANCIA_QUIETO = Number(process.env.TRACKING_PARKED_TOLERANCE || 0.03);

// Si la última vez que se lo vio fue hace más que esto, la estadía se da por terminada y
// la próxima lectura abre una nueva.
const CORTE_ESTADIA_MIN = Number(process.env.TRACKING_PARKED_GAP_MIN || 20);

type Caja = { x: number; y: number; w: number; h: number };

const leerCaja = (v: any): Caja | null => {
    try {
        const c = typeof v === "string" ? JSON.parse(v) : v;
        return c && [c.x, c.y, c.w, c.h].every((n: any) => Number.isFinite(Number(n))) ? c : null;
    } catch { return null; }
};

/**
 * ¿Es el mismo vehículo, en el mismo lugar del cuadro?
 *
 * Se comparan el centro y el tamaño. El centro dice si se movió; el tamaño, si se acercó
 * o se alejó — un auto que avanza hacia la cámara puede mantener el centro y crecer.
 */
function estaQuieto(a: Caja | null, b: Caja | null) {
    if (!a || !b) return false;
    const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const corrido = Math.hypot(ca.x - cb.x, ca.y - cb.y);
    const cambioTam = Math.abs(a.w - b.w) / Math.max(a.w, b.w, 0.001);
    return corrido <= TOLERANCIA_QUIETO && cambioTam <= 0.25;
}

/**
 * POST /api/tracking/sighting
 *
 * Recibe la lectura ya consolidada por la ráfaga. Acá se decide algo que importa: si es
 * un vehículo que PASÓ o uno que está ESTACIONADO dentro del encuadre.
 *
 * Un auto quieto se vuelve a leer con cada vehículo que cruza. Tratarlo como avistamiento
 * nuevo llenaba el historial de repeticiones y hacía que el mapa dibujara recorridos que
 * nunca ocurrieron. Ahora una estadía es UNA fila, con su intervalo, que se va extendiendo
 * mientras el auto siga ahí.
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
    const caja = leerCaja(body.bbox);

    // ── ¿Sigue ahí el mismo auto quieto?
    const desdeEstadia = new Date(cuando.getTime() - CORTE_ESTADIA_MIN * 60 * 1000);
    const previo = await prisma.plateSighting.findFirst({
        where: {
            plate: patente,
            deviceId: body.deviceId || null,
            source: "TRACK",
            timestamp: { gte: desdeEstadia, lte: cuando },
        },
        orderBy: { timestamp: "desc" },
    });

    if (previo && caja && estaQuieto(caja, leerCaja(previo.bbox))) {
        // No es una lectura nueva: es el mismo auto, en el mismo lugar. Se extiende la
        // estadía en vez de agregar una fila, y se guarda la mejor foto de las dos.
        const mejorFoto = confianza != null && (previo.confidence ?? 0) < confianza;
        const actualizado = await prisma.plateSighting.update({
            where: { id: previo.id },
            data: {
                estado: "ESTACIONADO",
                estDesde: previo.estDesde ?? previo.timestamp,
                estHasta: cuando,
                confidence: mejorFoto ? confianza : previo.confidence,
                reads: mejorFoto ? (lecturas ?? previo.reads) : previo.reads,
                snapshotUrl: mejorFoto ? (body.snapshotUrl || previo.snapshotUrl) : previo.snapshotUrl,
                bbox: JSON.stringify(caja),
            },
        });
        return NextResponse.json({
            ok: true, estado: "ESTACIONADO", id: actualizado.id,
            desde: actualizado.estDesde, hasta: actualizado.estHasta,
        });
    }

    // Antirrebote. La pasarela ya consolida cada paso en una sola lectura; esto cubre dos
    // ráfagas encadenadas y las instalaciones viejas que mandan un aviso por cuadro.
    const ventanaSeg = Number(process.env.TRACKING_DEDUPE_SECONDS || 45);
    if (previo && cuando.getTime() - new Date(previo.timestamp).getTime() <= ventanaSeg * 1000) {
        if (confianza != null && (previo.confidence ?? 0) < confianza) {
            await prisma.plateSighting.update({
                where: { id: previo.id },
                data: {
                    confidence: confianza,
                    reads: lecturas ?? previo.reads,
                    snapshotUrl: body.snapshotUrl || previo.snapshotUrl,
                    ...(caja ? { bbox: JSON.stringify(caja) } : {}),
                },
            }).catch(() => { });
        }
        return NextResponse.json({ ok: true, ignorado: "repetido", estado: "PASO", id: previo.id }, { status: 202 });
    }

    let { lat, lng } = body;
    if ((lat == null || lng == null) && body.deviceId) {
        const row = await prisma.setting.findUnique({ where: { key: "BARRIO_MAP" } });
        try {
            const cam = (JSON.parse(row?.value || "{}").cameras || []).find((c: any) => c.deviceId === body.deviceId);
            if (cam) { lat = cam.lat; lng = cam.lng; }
        } catch { }
    }

    // ── Trayecto: se engancha al último paso abierto de esa matrícula, o se abre uno.
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
        pass = await prisma.vehiclePass.create({ data: { plate: patente, startedAt: cuando, endedAt: cuando } });
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
            bbox: caja ? JSON.stringify(caja) : null,
            estado: "PASO",
            passId: pass.id,
        },
    });

    return NextResponse.json({ ok: true, estado: "PASO", id: creado.id, passId: pass.id });
}
