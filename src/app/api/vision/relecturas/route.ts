import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { leerAjuste } from "@/lib/ajustes-db";

export const dynamic = "force-dynamic";

/** Rangos que ofrece la pantalla, en horas. */
const RANGOS_H = new Set([6, 24, 72, 168]);
/** Cuántas relecturas se listan. */
const LISTA_MAX = 200;
/**
 * Ventana para «la vio otra cámara»: la misma chapa leída por cualquier lectora en ±6 h.
 * Es la única prueba de que una relectura estaba bien sin que nadie la mire: el auto que la
 * Salida no leyó casi siempre lo leyó la Entrada cuando llegó.
 */
const OTRA_LECTURA_H = 6;
const NO_LEIDAS = ["NO_LEIDA", "UNKNOWN", "unknown", "S/P"];
/** La relectura puede ser hasta un día posterior al evento (la puesta al día del worker). */
const MARGEN_RELECTURA_MS = 24 * 3600_000;

/**
 * GET /api/vision/relecturas?h=24 — cómo le va a la relectura de NO_LEIDA (vision-relectura.js).
 *
 * Lo que la pantalla necesita para decidir si sirve: cuántas NO_LEIDA hubo, cuántas se
 * releyeron y con qué resultado, cuántas sugerencias confirmó otra cámara, y qué hizo el
 * guardia (si cargó la misma chapa, otra, o nada).
 */
export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("No es una vista de pantalla.");
    const hq = Number(req.nextUrl.searchParams.get("h"));
    const h = RANGOS_H.has(hq) ? hq : 24;
    const desde = new Date(Date.now() - h * 3600_000);

    const [filas, noLeidas, estadoCrudo, analiticasCrudo] = await Promise.all([
        // Por la hora del EVENTO, no de la relectura: al arrancar, el worker relee el último día de
        // una vez, y contar por hora de relectura daba más releídas que NO_LEIDA en el rango.
        // Se piden las relecturas de un margen más y se filtran abajo por la hora del evento.
        prisma.relectura.findMany({ where: { createdAt: { gte: new Date(desde.getTime() - MARGEN_RELECTURA_MS) } }, orderBy: { createdAt: "desc" }, take: 3000 }),
        prisma.accessEvent.count({ where: { accessType: "PLATE", timestamp: { gte: desde }, plateDetected: { in: NO_LEIDAS } } }),
        leerAjuste("VISION_REGISTRO_ESTADO"),
        leerAjuste("VISION_ANALITICAS"),
    ]);
    const eventos = filas.length ? await prisma.accessEvent.findMany({
        where: { id: { in: filas.map((f) => f.accessEventId) } },
        select: { id: true, timestamp: true, plateDetected: true, decision: true, direction: true, snapshotPath: true, device: { select: { name: true } } },
    }) : [];
    const evento = new Map(eventos.map((e) => [e.id, e]));
    const enRango = filas.filter((f) => { const e = evento.get(f.accessEventId); return !!e && e.timestamp >= desde; });

    // ¿La vio otra cámara? Una consulta para todas las chapas sugeridas.
    const sugeridas = [...new Set(enRango.map((f) => f.plate).filter(Boolean))] as string[];
    const lecturas = sugeridas.length ? await prisma.accessEvent.findMany({
        where: { plateDetected: { in: sugeridas }, timestamp: { gte: new Date(desde.getTime() - OTRA_LECTURA_H * 3600_000) } },
        select: { id: true, plateDetected: true, timestamp: true, device: { select: { name: true } } },
    }) : [];
    const porChapa = new Map<string, typeof lecturas>();
    for (const l of lecturas) porChapa.set(l.plateDetected!, [...(porChapa.get(l.plateDetected!) || []), l]);

    const conteo = { releidas: enRango.length, leidas: 0, dudosas: 0, sinChapa: 0, sinVehiculo: 0, sinFoto: 0, errores: 0, confirmadasOtraCamara: 0, guardiaIgual: 0, guardiaDistinta: 0 };
    const lista = enRango.map((f) => {
        const e = evento.get(f.accessEventId);
        if (f.estado === "LEIDA") conteo.leidas++; else if (f.estado === "DUDOSA") conteo.dudosas++;
        else if (f.estado === "SIN_CHAPA") conteo.sinChapa++; else if (f.estado === "SIN_VEHICULO") conteo.sinVehiculo++;
        else if (f.estado === "SIN_FOTO") conteo.sinFoto++; else conteo.errores++;
        const t = e?.timestamp.getTime() ?? f.createdAt.getTime();
        const otra = f.plate ? (porChapa.get(f.plate) || []).find((l) => l.id !== f.accessEventId && Math.abs(l.timestamp.getTime() - t) <= OTRA_LECTURA_H * 3600_000) : undefined;
        if (otra) conteo.confirmadasOtraCamara++;
        // Lo que hizo el guardia: el evento ya no es NO_LEIDA si cargó la matrícula a mano.
        const actual = e?.plateDetected || null;
        const corregido = actual && !NO_LEIDAS.includes(actual) ? actual : null;
        if (corregido && f.plate) { if (corregido === f.plate) conteo.guardiaIgual++; else conteo.guardiaDistinta++; }
        const c: any = f.candidatos || {};
        return {
            id: f.id, eventoId: f.accessEventId, ts: (e?.timestamp || f.createdAt).toISOString(),
            camara: e?.device?.name || null, sentido: e?.direction || null, decision: e?.decision || null,
            foto: e?.snapshotPath || null,
            estado: f.estado, plate: f.plate, confianza: f.confianza, vehiculo: f.vehiculo, vehiculos: f.vehiculos,
            acuerdo: c.acuerdo ?? null, otras: Array.isArray(c.otras) ? c.otras : [],
            recorte: f.recorte ? `/api/vision/imagen/${f.recorte}` : null, chapa: f.recorteChapa ? `/api/vision/imagen/${f.recorteChapa}` : null,
            ms: f.ms, error: f.error,
            otraCamara: otra ? { camara: otra.device?.name || null, ts: otra.timestamp.toISOString() } : null,
            guardia: corregido,
        };
    });

    let estado: any = null, activa = true;
    try { estado = JSON.parse(estadoCrudo?.value || "null")?.relectura ?? null; } catch { }
    try { activa = (JSON.parse(analiticasCrudo?.value || "{}") || {}).relectura !== false; } catch { }
    return NextResponse.json({ h, noLeidas, conteo, activa, estado, otraLecturaH: OTRA_LECTURA_H, filas: lista.slice(0, LISTA_MAX) });
}
