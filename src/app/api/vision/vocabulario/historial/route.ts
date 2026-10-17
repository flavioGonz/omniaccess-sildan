import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/api-auth";
import { buscarVocabulario } from "@/lib/vision";
import { consultasDe, traducirConsulta } from "@/lib/vocabulario";
import { getImagePath } from "@/lib/image-path";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/vision/vocabulario/historial — buscar un OBJETO por nombre en las fotos del historial.
 *   { q: "carretilla, escalera", desde?: "AAAA-MM-DD", hasta?: "AAAA-MM-DD", camaras?: [nombre],
 *     antesDe?: ISO, lote?: n }
 *   → { total?, revisadas, hallazgos: [{ eventId, ts, camara, plate, foto, objetos }], siguiente, consultas }
 *
 * (17/10, Nico: el vocabulario abierto «también en el buscador del historial».) La búsqueda de
 * texto del historial busca en lo que YA se anotó de cada lectura (chapa, persona, lo que
 * registró OmniVision); esto mira las FOTOS de nuevo, buscando lo que se escriba, aunque nadie lo
 * haya anotado nunca. Por eso es más lenta: cada foto es una pasada de OWLv2 (~0,25 s en GPU).
 *
 * Va de a lotes chicos y la pantalla pide el siguiente (`siguiente` = la hora de la última foto
 * revisada): así muestra lo que encuentra a medida que avanza, se puede parar, y ningún pedido
 * dura más de unos segundos. Las fotos se piden a la propia app, como hace vision-relectura.
 */
const APP = (process.env.APP_INTERNAL_URL || "http://127.0.0.1:10001").replace(/\/$/, "");
const LOTE_DEFECTO = 10;
const LOTE_MAX = 20;

async function foto(ruta: string): Promise<Buffer | null> {
    const u = getImagePath(ruta);
    if (!u) return null;
    try {
        const r = await fetch(u.startsWith("http") ? u : APP + u, { signal: AbortSignal.timeout(10000), cache: "no-store" });
        if (!r.ok) return null;
        const b = Buffer.from(await r.arrayBuffer());
        return b.length > 1000 ? b : null;
    } catch { return null; }
}

export async function POST(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    if (auth.pantalla) return forbiddenResponse("La búsqueda no es una vista de pantalla.");
    const b = await req.json().catch(() => ({}));
    const pedidas = consultasDe(String(b?.q || ""));
    if (!pedidas.length) return NextResponse.json({ error: "Escribí qué objeto buscar" }, { status: 400 });
    const consultas = pedidas.map(traducirConsulta);
    const lote = Math.min(LOTE_MAX, Math.max(1, Number(b?.lote) || LOTE_DEFECTO));

    // El rango: el del historial (días enteros, hasta inclusive). Sin rango, las últimas 24 h.
    const desde = b?.desde ? new Date(`${b.desde}T00:00:00`) : new Date(Date.now() - 864e5);
    const hasta = b?.hasta ? new Date(`${b.hasta}T23:59:59.999`) : new Date();
    const antesDe = b?.antesDe ? new Date(b.antesDe) : null;
    const camaras: string[] = Array.isArray(b?.camaras) ? b.camaras.filter((x: unknown) => typeof x === "string").slice(0, 50) : [];
    // Con cursor se sigue desde la última foto revisada (estrictamente antes); sin cursor, todo el rango.
    const tope = antesDe && antesDe < hasta ? antesDe : hasta;
    const donde: any = {
        timestamp: antesDe ? { gte: desde, lt: tope } : { gte: desde, lte: hasta },
        OR: [{ snapshotPath: { not: null } }, { imagePath: { not: null } }],
        ...(camaras.length ? { device: { name: { in: camaras } } } : {}),
    };

    const [total, eventos] = await Promise.all([
        antesDe ? Promise.resolve(undefined) : prisma.accessEvent.count({ where: { ...donde } }),
        prisma.accessEvent.findMany({
            where: donde, orderBy: { timestamp: "desc" }, take: lote,
            select: { id: true, timestamp: true, plateDetected: true, snapshotPath: true, imagePath: true, device: { select: { name: true } } },
        }),
    ]);

    const hallazgos: any[] = [];
    const porEnviada = new Map(consultas.map((c) => [c.enviada, c.escrita]));
    // De a una: omni-vision atiende una inferencia a la vez; en paralelo sólo se encolarían allá.
    for (const e of eventos) {
        const ruta = e.snapshotPath || e.imagePath;
        const img = ruta ? await foto(ruta) : null;
        if (!img) continue;
        try {
            const v = await buscarVocabulario(img, consultas.map((c) => c.enviada));
            if (v.objetos.length) hallazgos.push({
                eventId: e.id, ts: e.timestamp.toISOString(), camara: e.device?.name || null, plate: e.plateDetected,
                foto: getImagePath(ruta),
                objetos: v.objetos.map((o) => ({ nombre: porEnviada.get(o.nombre) || o.nombre, confianza: o.confianza, caja_norm: o.caja_norm })),
            });
        } catch (x: any) {
            // Apagado o sin el modelo: no tiene sentido seguir foto por foto.
            const msg = x?.message || "omni-vision falló";
            if (/apagada|no trae|501|409/.test(msg)) return NextResponse.json({ error: /apagada/.test(msg) ? "El vocabulario abierto está apagado (OmniVision › tareas)." : "Este servidor todavía no tiene el vocabulario abierto instalado." }, { status: 409 });
            if (hallazgos.length === 0 && eventos.indexOf(e) === 0) return NextResponse.json({ error: msg }, { status: 502 });
        }
    }
    const ultimo = eventos[eventos.length - 1];
    return NextResponse.json({
        ...(total !== undefined ? { total } : {}),
        revisadas: eventos.length, hallazgos, consultas,
        siguiente: eventos.length === lote && ultimo ? ultimo.timestamp.toISOString() : null,
    }, { headers: { "Cache-Control": "no-store" } });
}
