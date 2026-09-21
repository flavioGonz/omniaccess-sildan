/**
 * GET /api/lpr/read-rate?days=7 — cuánto está leyendo el sistema, y dónde no.
 *
 * ## Por qué son DOS mediciones y no una
 *
 * La pantalla mostraba un solo número y decía "tasa de lectura", pero medía únicamente
 * las cámaras de barrera. Las de seguimiento no aparecían — y no porque estuvieran
 * filtradas: para ellas **no existía el denominador**.
 *
 * En la barrera la cámara Hikvision dispara siempre y escribe `NO_LEIDA` cuando no
 * reconoce. El evento queda igual, así que "cuántas veces miró" se puede contar desde la
 * misma tabla que "cuántas veces leyó".
 *
 * En seguimiento no pasa nada de eso. Una ráfaga que no da ninguna matrícula no escribe
 * ninguna fila: el intento no deja rastro. Contar avistamientos daría un numerador suelto
 * — "Calle 21 leyó 40 chapas" no dice si leyó el 90% o el 9%.
 *
 * Por eso el denominador del seguimiento es la RÁFAGA, que la pasarela cuenta por cámara
 * y por minuto en TrackingCamaraMuestra. Son dos cosas distintas medidas contra dos
 * denominadores distintos, y por eso van en dos bloques separados en vez de sumarse en un
 * promedio único: un promedio entre ellas no significaría nada.
 *
 * ## El descarte que no es un fallo
 *
 * `fueraDeLinea` cuenta lecturas BUENAS que se tiraron porque cayeron afuera de la zona o
 * de la línea del calibrador. No son un fallo del lector: son una decisión del operador.
 * Meterlas en el denominador hundiría la tasa de una cámara bien calibrada, que es
 * exactamente al revés de lo que el panel tiene que decir. Se informan aparte.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Lo que el ANPR escribe cuando disparó y no reconoció nada. */
const SIN_LEER = ["NO_LEIDA", "unknown", "UNKNOWN", "S/P", ""];

const ZONA = "America/Montevideo";

const pct = (parte: number, total: number) =>
    total ? Math.round((parte / total) * 1000) / 10 : null;

export async function GET(req: NextRequest) {
    const days = Math.min(90, Math.max(1, parseInt(req.nextUrl.searchParams.get("days") || "7", 10)));
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    try {
        // ── Barrera (ANPR) ──────────────────────────────────────────────────────
        const perCameraRaw: any[] = await prisma.$queryRaw`
            SELECT e."deviceId" AS "deviceId", d."name" AS name, d."direction" AS direction,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE e."plateDetected" IS NOT NULL AND e."plateDetected" NOT IN ('NO_LEIDA','unknown','UNKNOWN','S/P',''))::int AS read
            FROM "AccessEvent" e LEFT JOIN "Device" d ON d."id" = e."deviceId"
            WHERE e."accessType" = 'PLATE' AND e."timestamp" >= ${since}
            GROUP BY e."deviceId", d."name", d."direction"
            ORDER BY total DESC`;
        const perHourRaw: any[] = await prisma.$queryRaw`
            SELECT EXTRACT(HOUR FROM (e."timestamp" AT TIME ZONE 'America/Montevideo'))::int AS hr,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE e."plateDetected" IS NOT NULL AND e."plateDetected" NOT IN ('NO_LEIDA','unknown','UNKNOWN','S/P',''))::int AS read
            FROM "AccessEvent" e
            WHERE e."accessType" = 'PLATE' AND e."timestamp" >= ${since}
            GROUP BY hr ORDER BY hr`;

        const perCamera = perCameraRaw.map((r) => {
            const total = Number(r.total), read = Number(r.read);
            return { deviceId: r.deviceId, name: r.name || "—", direction: r.direction, total, read, unread: total - read, ratePct: pct(read, total) };
        }).sort((a, b) => (a.ratePct ?? 101) - (b.ratePct ?? 101)); // peor primero

        const byHour: Record<number, { total: number; read: number }> = {};
        for (let h = 0; h < 24; h++) byHour[h] = { total: 0, read: 0 };
        for (const r of perHourRaw) { const h = Number(r.hr); byHour[h] = { total: Number(r.total), read: Number(r.read) }; }
        const perHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: byHour[h].total, read: byHour[h].read, ratePct: pct(byHour[h].read, byHour[h].total) }));

        const total = perCamera.reduce((s, c) => s + c.total, 0);
        const read = perCamera.reduce((s, c) => s + c.read, 0);
        const overall = { total, read, unread: total - read, ratePct: pct(read, total) };

        // ── Seguimiento (cámaras comunes + Omni-LPR) ────────────────────────────
        // El nombre se toma del Device si la cámara sigue existiendo, y si no del que la
        // pasarela guardó en la muestra: una cámara dada de baja tiene que seguir
        // apareciendo en su historial con su nombre y no como un identificador suelto.
        const segCamRaw: any[] = await prisma.$queryRaw`
            SELECT m."deviceId" AS "deviceId",
                COALESCE(d."name", MAX(m."nombre")) AS name,
                SUM(m."disparos")::int     AS disparos,
                SUM(m."lecturas")::int     AS lecturas,
                SUM(m."descartes")::int    AS descartes,
                SUM(m."fueraDeLinea")::int AS "fueraDeLinea",
                SUM(m."frenados")::int     AS frenados
            FROM "TrackingCamaraMuestra" m LEFT JOIN "Device" d ON d."id" = m."deviceId"
            WHERE m."momento" >= ${since}
            GROUP BY m."deviceId", d."name"`;
        const segHoraRaw: any[] = await prisma.$queryRaw`
            SELECT EXTRACT(HOUR FROM (m."momento" AT TIME ZONE 'America/Montevideo'))::int AS hr,
                SUM(m."disparos")::int AS disparos,
                SUM(m."lecturas")::int AS lecturas
            FROM "TrackingCamaraMuestra" m
            WHERE m."momento" >= ${since}
            GROUP BY hr ORDER BY hr`;

        const segPorCamara = segCamRaw.map((r) => {
            const disparos = Number(r.disparos), lecturas = Number(r.lecturas);
            return {
                deviceId: r.deviceId,
                name: r.name || "—",
                disparos,
                lecturas,
                descartes: Number(r.descartes),
                fueraDeLinea: Number(r.fueraDeLinea),
                frenados: Number(r.frenados),
                ratePct: pct(lecturas, disparos),
            };
        }).sort((a, b) => (a.ratePct ?? 101) - (b.ratePct ?? 101));

        const segHora: Record<number, { disparos: number; lecturas: number }> = {};
        for (let h = 0; h < 24; h++) segHora[h] = { disparos: 0, lecturas: 0 };
        for (const r of segHoraRaw) segHora[Number(r.hr)] = { disparos: Number(r.disparos), lecturas: Number(r.lecturas) };
        const segPorHora = Array.from({ length: 24 }, (_, h) => ({
            hour: h, disparos: segHora[h].disparos, lecturas: segHora[h].lecturas,
            ratePct: pct(segHora[h].lecturas, segHora[h].disparos),
        }));

        const segDisparos = segPorCamara.reduce((s, c) => s + c.disparos, 0);
        const segLecturas = segPorCamara.reduce((s, c) => s + c.lecturas, 0);
        const seguimiento = {
            // Sin muestras no es lo mismo que cero: puede ser que la pasarela no haya
            // escrito nunca (recien desplegada) o que no haya cámaras de seguimiento. La
            // pantalla necesita poder decir "todavía no hay datos" en vez de "0%".
            hayDatos: segPorCamara.length > 0,
            overall: {
                disparos: segDisparos,
                lecturas: segLecturas,
                descartes: segPorCamara.reduce((s, c) => s + c.descartes, 0),
                fueraDeLinea: segPorCamara.reduce((s, c) => s + c.fueraDeLinea, 0),
                frenados: segPorCamara.reduce((s, c) => s + c.frenados, 0),
                ratePct: pct(segLecturas, segDisparos),
            },
            perCamera: segPorCamara,
            perHour: segPorHora,
        };

        return NextResponse.json({ ok: true, days, overall, perCamera, perHour, seguimiento, sinLeer: SIN_LEER, zona: ZONA });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "read-rate error" }, { status: 500 });
    }
}
