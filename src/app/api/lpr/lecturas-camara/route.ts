import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { leerAjuste } from "@/lib/ajustes-db";
import { normalizarMatricula } from "@/lib/lista-negra";

export const dynamic = "force-dynamic";

/**
 * GET /api/lpr/lecturas-camara?camara=<id>&h=6 — lo que leyó la cámara (su propio registro,
 * copiado por camara-log.js) al lado de lo que recibió OmniAccess (AccessEvent) y de lo que
 * releyó OmniVision (Relectura), apareado por tiempo. Pedido de Nico (16/10): validar las
 * detecciones comparándolas con el log de la cámara.
 *
 * Cómo se aparea: por cámara, cada lectura de la cámara con el evento más cercano en ±VENTANA_MS
 * que todavía no se usó, prefiriendo el de la misma chapa. Con eso cada fila es una de:
 *  · coincide  — la cámara leyó y OmniAccess recibió la misma chapa (o las dos «sin leer»);
 *  · distinta  — llegó un evento a esa hora pero con otra chapa;
 *  · perdida   — la cámara la tiene y a OmniAccess no le llegó nada: el caso que no se veía;
 *  · solo      — OmniAccess tiene el evento y la cámara no lo registra. Sólo se cuenta dentro
 *                de lo que el registro cubre (desde la primera copia); antes, no se sabe.
 */
const RANGOS_H = new Set([1, 6, 24, 72, 168]);
/** Hasta cuánta diferencia de reloj se acepta entre la captura de la cámara y el evento recibido. */
const VENTANA_MS = 10_000;
const FILAS_MAX = 1500;
const NO_LEIDAS = new Set(["NO_LEIDA", "UNKNOWN", "S/P", ""]);
const chapa = (p: string | null | undefined) => { const n = normalizarMatricula(p || ""); return n && !NO_LEIDAS.has(n) ? n : null; };

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("No es una vista de pantalla.");
    const sp = req.nextUrl.searchParams;
    const h = RANGOS_H.has(Number(sp.get("h"))) ? Number(sp.get("h")) : 6;
    const camara = sp.get("camara") || "";
    const desde = new Date(Date.now() - h * 3600_000);

    // Las cámaras que tienen registro copiado, con su estado de copia.
    const [conRegistro, estadoCrudo] = await Promise.all([
        prisma.lecturaCamara.groupBy({ by: ["deviceId"], _count: { _all: true }, _min: { ts: true }, _max: { ts: true } }),
        leerAjuste("CAMARA_LOG_ESTADO"),
    ]);
    let estado: any = null;
    try { estado = JSON.parse(estadoCrudo?.value || "null"); } catch { estado = null; }
    const ids = conRegistro.map((c) => c.deviceId);
    const nombres = new Map((await prisma.device.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]));
    const camaras = conRegistro.map((c) => ({
        id: c.deviceId, nombre: nombres.get(c.deviceId) || c.deviceId, total: c._count._all,
        desde: c._min.ts?.toISOString() || null, hasta: c._max.ts?.toISOString() || null,
        copia: estado?.camaras?.[c.deviceId] ? { ultimo: estado.camaras[c.deviceId].ultimo, error: estado.camaras[c.deviceId].error } : null,
    })).sort((a, b) => a.nombre.localeCompare(b.nombre));
    const elegidas = camara && ids.includes(camara) ? [camara] : ids;
    if (!elegidas.length) return NextResponse.json({ h, camaras, filas: [], resumen: null, estado: estado ? { t: estado.t, cadaMs: estado.cadaMs } : null });

    const [deCamara, eventos] = await Promise.all([
        prisma.lecturaCamara.findMany({ where: { deviceId: { in: elegidas }, ts: { gte: desde } }, orderBy: { ts: "asc" }, take: FILAS_MAX }),
        prisma.accessEvent.findMany({
            where: { deviceId: { in: elegidas }, timestamp: { gte: new Date(desde.getTime() - VENTANA_MS) } },
            select: { id: true, timestamp: true, deviceId: true, plateDetected: true, decision: true, direction: true, snapshotPath: true, imagePath: true },
            orderBy: { timestamp: "asc" }, take: FILAS_MAX * 2,
        }),
    ]);
    const relecturas = eventos.length ? await prisma.relectura.findMany({
        where: { accessEventId: { in: eventos.map((e) => e.id) } }, select: { accessEventId: true, plate: true, estado: true, confianza: true },
    }) : [];
    const releida = new Map(relecturas.map((r) => [r.accessEventId, r]));
    const cubreDesde = new Map(conRegistro.map((c) => [c.deviceId, c._min.ts?.getTime() ?? Infinity]));

    // El apareo, por cámara.
    const usados = new Set<string>();
    type Ev = (typeof eventos)[number];
    const porCamaraEv = new Map<string, Ev[]>();
    for (const e of eventos) { const k = e.deviceId || ""; (porCamaraEv.get(k) || porCamaraEv.set(k, []).get(k)!).push(e); }
    const filas: any[] = [];
    const desfasajes: number[] = [];
    for (const l of deCamara) {
        const lista = porCamaraEv.get(l.deviceId) || [];
        const t = l.ts.getTime(), cp = chapa(l.plate);
        let mejor: Ev | null = null, mejorPeso = Infinity;
        for (const e of lista) {
            if (usados.has(e.id)) continue;
            const d = Math.abs(e.timestamp.getTime() - t);
            if (d > VENTANA_MS) continue;
            // La misma chapa pesa como si estuviera 8 s más cerca: con dos autos seguidos, cada uno con el suyo.
            const peso = d - (cp && chapa(e.plateDetected) === cp ? 8000 : 0);
            if (peso < mejorPeso) { mejor = e; mejorPeso = peso; }
        }
        if (mejor) { usados.add(mejor.id); desfasajes.push(mejor.timestamp.getTime() - t); }
        const ce = mejor ? chapa(mejor.plateDetected) : null;
        const r = mejor ? releida.get(mejor.id) : null;
        filas.push({
            id: l.id, ts: l.ts.toISOString(), deviceId: l.deviceId, camara: nombres.get(l.deviceId) || "",
            cam: { plate: l.plate, pais: l.pais, sentido: l.sentido, lista: l.lista, picName: l.picName },
            omni: mejor ? { id: mejor.id, ts: mejor.timestamp.toISOString(), plate: mejor.plateDetected, decision: String(mejor.decision), sentido: String(mejor.direction), foto: mejor.snapshotPath || mejor.imagePath || null } : null,
            vision: r ? { plate: r.plate, estado: r.estado, confianza: r.confianza } : null,
            estado: !mejor ? "perdida" : cp === ce ? "coincide" : "distinta",
        });
    }
    for (const e of eventos) {
        if (usados.has(e.id) || e.timestamp < desde) continue;
        if (e.timestamp.getTime() < (cubreDesde.get(e.deviceId || "") ?? Infinity)) continue;
        const r = releida.get(e.id);
        filas.push({
            id: `e-${e.id}`, ts: e.timestamp.toISOString(), deviceId: e.deviceId, camara: nombres.get(e.deviceId || "") || "",
            cam: null,
            omni: { id: e.id, ts: e.timestamp.toISOString(), plate: e.plateDetected, decision: String(e.decision), sentido: String(e.direction), foto: e.snapshotPath || e.imagePath || null },
            vision: r ? { plate: r.plate, estado: r.estado, confianza: r.confianza } : null,
            estado: "solo",
        });
    }
    filas.sort((a, b) => b.ts.localeCompare(a.ts));
    const cuenta = (k: string) => filas.filter((f) => f.estado === k).length;
    const ordenados = [...desfasajes].sort((a, b) => a - b);
    const resumen = {
        camara: deCamara.length, coincide: cuenta("coincide"), distinta: cuenta("distinta"), perdida: cuenta("perdida"), solo: cuenta("solo"),
        // Cuánto tarda en llegar (o cuánto difieren los relojes): la mediana de evento − captura.
        desfasajeMs: ordenados.length ? ordenados[Math.floor(ordenados.length / 2)] : null,
        sinLeerCamara: deCamara.filter((l) => !l.plate).length,
    };
    return NextResponse.json({ h, camaras, filas: filas.slice(0, FILAS_MAX), resumen, estado: estado ? { t: estado.t, cadaMs: estado.cadaMs } : null }, { headers: { "Cache-Control": "no-store" } });
}
