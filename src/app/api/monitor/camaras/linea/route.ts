export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor, SIN_CACHE } from "@/lib/monitor/servidor";
import { resolveNvrById } from "@/lib/nvr-resolve";
import { authenticatedRequest } from "@/lib/digest-auth";
import { ZONA } from "@/lib/fechas";

/**
 * GET /api/monitor/camaras/linea?nvr=<id>&ch=<n>&dia=YYYY-MM-DD[&equipo=<id>]
 *   → { tramos: [desdeMs, hastaMs][] | null, eventos: [...] }
 *
 * Lo que dibuja la regla de la grabación sobre el video, para un día:
 *  · tramos: dónde HAY grabación en el NVR (ISAPI ContentMgmt/search). Antes la regla era lisa y
 *    se sabía que no había grabación recién después de esperar 9 s a que el NVR no mandara nada;
 *    ahora el hueco se ve antes de tocarlo. null = no se pudo saber (Dahua, NVR caído): la
 *    pantalla no pinta tramos en vez de pintar «no hay».
 *  · eventos: las detecciones de la cámara, sus lecturas si lee chapas, y lo que registró
 *    OmniVision (personas, vehículos, animales). Son las marcas de la regla —sobre la franja
 *    verde— y lo que recorren las flechas de «evento anterior / siguiente».
 *
 * Sólo lectura. Se pide al abrir la grabación y al cambiar de día, no en bucle.
 */

/** Hasta cuántos tramos se piden por día (páginas de 100). Un canal que graba por movimiento puede tener cientos. */
const PAGINAS_MAX = 6;
/** Lo que OmniVision registra y vale la pena marcar en la regla. */
const GRUPOS_VISION = ["persona", "vehiculo", "animal", "propio"];
/** Hasta cuántas marcas por día: más no se distinguen en la regla y sólo pesan. */
const EVENTOS_MAX = 600;
/** La etiqueta con la que server.js deja la detección de un canal que no está en el mapa. */
const etiquetaCanal = (ch: number) => `canal ${ch} sin mapear`;

/**
 * Los NVR guardan y contestan su hora local marcada con Z (ver lib/clip-nvr). Esto pasa
 * «YYYY-MM-DDTHH:MM:SS» de la hora del barrio a milisegundos reales.
 */
function msDeLocal(texto: string): number | null {
    const m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(texto); if (!m) return null;
    const comoUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    const partes = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(comoUtc));
    const g = (t: string) => Number(partes.find((x) => x.type === t)?.value || 0);
    const vistoEnZona = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
    return comoUtc - (vistoEnZona - comoUtc);
}

async function tramosHik(conn: { ip: string; user: string; pass: string }, ch: number, dia: string): Promise<[number, number][] | null> {
    const dev = { ip: conn.ip, username: conn.user, password: conn.pass, authType: "DIGEST" } as any;
    const tramos: [number, number][] = [];
    let pos = 0;
    for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
        const body = `<CMSearchDescription><searchID>${crypto.randomUUID()}</searchID><trackIDList><trackID>${ch}01</trackID></trackIDList><timeSpanList><timeSpan><startTime>${dia}T00:00:00Z</startTime><endTime>${dia}T23:59:59Z</endTime></timeSpan></timeSpanList><maxResults>100</maxResults><searchResultPostion>${pos}</searchResultPostion></CMSearchDescription>`;
        let xml: string;
        try { xml = String(await authenticatedRequest("POST", "/ISAPI/ContentMgmt/search", dev, { data: body, contentType: "application/xml", accept: "application/xml", responseType: "text", timeout: 12000 })); }
        catch { return pagina === 0 ? null : tramos; }
        for (const m of xml.matchAll(/<startTime>([^<]+)<\/startTime>\s*<endTime>([^<]+)<\/endTime>/g)) {
            const a = msDeLocal(m[1]), b = msDeLocal(m[2]);
            if (a != null && b != null && b > a) tramos.push([a, b]);
        }
        const n = Number((xml.match(/<numOfMatches>(\d+)</) || [])[1] || 0);
        pos += n;
        if (n < 100) break;
    }
    // Ordenados y pegados: el NVR corta los archivos por hora y la regla los quiere continuos.
    tramos.sort((x, y) => x[0] - y[0]);
    const unidos: [number, number][] = [];
    for (const t of tramos) {
        const u = unidos[unidos.length - 1];
        if (u && t[0] <= u[1] + 2000) u[1] = Math.max(u[1], t[1]); else unidos.push([...t] as [number, number]);
    }
    return unidos;
}

export async function GET(req: NextRequest) {
    const p = await autorizarMonitor("/api/monitor/camaras/linea");
    if (p.error) return p.error;
    const sp = req.nextUrl.searchParams;
    const nvrId = sp.get("nvr") || "";
    const ch = parseInt(sp.get("ch") || "", 10);
    const dia = sp.get("dia") || "";
    const equipo = sp.get("equipo") || "";
    // El id con el que OmniVision registra esta cámara: el del equipo, o `nvrch-<nvr>-<ch>`.
    const vid = equipo || `nvrch-${nvrId}-${ch}`;
    if (!/^[\w-]{1,80}$/.test(nvrId) || !(ch > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(dia) || (equipo && !/^[\w-]{1,80}$/.test(equipo))) {
        return NextResponse.json({ error: "nvr, ch y dia requeridos" }, { status: 400 });
    }
    const desde = msDeLocal(`${dia}T00:00:00`)!, hasta = msDeLocal(`${dia}T23:59:59`)! + 999;
    const rango = { gte: new Date(desde), lte: new Date(hasta) };

    const conn = await resolveNvrById(nvrId);
    const [tramos, detecciones, lecturas, vistos] = await Promise.all([
        conn && String(conn.brand).toUpperCase() !== "DAHUA" ? tramosHik(conn, ch, dia).catch(() => null) : Promise.resolve(null),
        prisma.detection.findMany({
            where: { timestamp: rango, type: { not: "MOTION" }, OR: [...(equipo ? [{ deviceId: equipo }] : []), { deviceId: nvrId, label: etiquetaCanal(ch) }] },
            select: { id: true, timestamp: true, type: true, label: true }, orderBy: { timestamp: "asc" }, take: EVENTOS_MAX,
        }).catch(() => []),
        equipo ? prisma.accessEvent.findMany({
            where: { deviceId: equipo, timestamp: rango },
            select: { id: true, timestamp: true, plateDetected: true, decision: true, direction: true, details: true }, orderBy: { timestamp: "asc" }, take: EVENTOS_MAX,
        }).catch(() => []) : Promise.resolve([]),
        // Lo que OmniVision registró en esta cámara (vision-worker): una marca por pista, al empezar.
        prisma.objetoVisto.findMany({
            where: { deviceId: vid, primeraVez: rango, grupo: { in: GRUPOS_VISION } },
            select: { id: true, primeraVez: true, ultimaVez: true, grupo: true, clase: true, confianza: true }, orderBy: { primeraVez: "asc" }, take: EVENTOS_MAX,
        }).catch(() => []),
    ]);

    const eventos = [
        ...detecciones.map((d) => ({ id: d.id, ts: d.timestamp.getTime(), clase: "deteccion" as const, tipo: String(d.type), plate: null as string | null, ok: null as boolean | null })),
        ...lecturas.map((l) => ({ id: l.id, ts: l.timestamp.getTime(), clase: "lectura" as const, tipo: String(l.direction), plate: l.plateDetected || null, ok: String(l.decision) === "GRANT" && !/lista negra/i.test(l.details || "") })),
        // `fin`: cuánto estuvo a la vista (la pista de OmniVision), para pintar el tramo en la regla.
        ...vistos.map((o) => ({ id: o.id, ts: o.primeraVez.getTime(), fin: o.ultimaVez.getTime(), clase: "vision" as const, tipo: o.grupo, nombre: o.grupo === "propio" ? o.clase : null, plate: null as string | null, ok: null as boolean | null })),
    ].sort((a, b) => a.ts - b.ts).slice(0, EVENTOS_MAX);

    return NextResponse.json({ dia, desde, hasta, tramos, eventos, marca: conn ? String(conn.brand) : null }, { headers: SIN_CACHE });
}

