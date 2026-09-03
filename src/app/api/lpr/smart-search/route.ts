/** GET /api/lpr/smart-search?q=camioneta blanca ayer a la tarde&max=80
 *  Búsqueda en lenguaje natural sobre los eventos de acceso LPR (índice propio: color, tipo,
 *  marca, matrícula, dirección, cámara, hora). No depende del NVR — cubre los accesos, que es
 *  justo donde AcuSeek/AcuSearch no llegan porque las cámaras están en modo ANPR (roadDetection).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseLprQuery, TYPE_ES } from "@/lib/lpr-query";

const TZ = "America/Montevideo";
const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hour12: false });
const localHour = (d: Date) => { const h = Number(hourFmt.format(d)); return h === 24 ? 0 : h; };

function parseDetails(details: string | null) {
    const out: Record<string, string> = {};
    (details || "").split(",").forEach(p => { const i = p.indexOf(":"); if (i > 0) { const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim(); if (k && v) out[k] = v; } });
    return out;
}

export async function GET(req: NextRequest) {
    const q = req.nextUrl.searchParams.get("q") || "";
    const max = Math.min(300, parseInt(req.nextUrl.searchParams.get("max") || "80", 10));
    const daysParam = parseInt(req.nextUrl.searchParams.get("days") || "0", 10);
    const p = parseLprQuery(q);

    // rango: el de la consulta, el pedido por la UI, o 30 días
    const to = p.to || new Date();
    const from = p.from || new Date(Date.now() - (daysParam > 0 ? daysParam : 30) * 86400000);

    const where: any = { accessType: "PLATE", timestamp: { gte: from, lte: to } };
    if (p.direction) where.direction = p.direction;
    if (p.decision) where.decision = p.decision;
    if (p.plate) where.plateDetected = { contains: p.plate, mode: "insensitive" };

    // color / tipo / marca viven dentro de `details` (texto) → AND de contains, OR dentro de cada familia
    const and: any[] = [];
    const orOf = (field: string, vals: string[]) => ({ OR: vals.map(v => ({ details: { contains: `${field}: ${v}`, mode: "insensitive" } })) });
    if (p.colors.length) and.push(orOf("Color", p.colors));
    if (p.types.length) and.push(orOf("Tipo", p.types));
    if (p.brands.length) and.push(orOf("Marca", p.brands));
    if (p.cameraHint) and.push({ device: { name: { contains: p.cameraHint, mode: "insensitive" } } });
    if (and.length) where.AND = and;

    // sin ningún criterio entendido: no devolvemos "todo", pedimos precisión
    const hasCriteria = !!(p.colors.length || p.types.length || p.brands.length || p.plate || p.direction || p.decision || p.cameraHint || p.hourFrom != null || p.from);
    if (!hasCriteria) {
        return NextResponse.json({ ok: true, source: "lpr", total: 0, matches: [], parsed: p, hint: "Probá con color, tipo de vehículo, marca, matrícula, acceso (P1…P7), o un rango: “camioneta blanca ayer a la tarde”." });
    }

    const rows = await prisma.accessEvent.findMany({
        where,
        select: {
            id: true, timestamp: true, plateDetected: true, direction: true, decision: true, details: true,
            snapshotPath: true, imagePath: true, deviceId: true,
            device: { select: { id: true, name: true } },
            user: { select: { name: true, unit: { select: { name: true } } } },
        },
        orderBy: { timestamp: "desc" },
        // la franja horaria se filtra en memoria (no es una columna): traigo un lote amplio del rango y recorto
        take: p.hourFrom != null ? 8000 : max,
    });

    const filtered = p.hourFrom != null
        ? rows.filter(r => { const h = localHour(new Date(r.timestamp)); return p.hourTo! > p.hourFrom! ? h >= p.hourFrom! && h < p.hourTo! : h >= p.hourFrom! || h < p.hourTo!; }).slice(0, max)
        : rows;

    const matches = filtered.map(r => {
        const m = parseDetails(r.details);
        return {
            id: r.id, time: r.timestamp, plate: r.plateDetected, direction: r.direction, decision: r.decision,
            deviceId: r.deviceId, deviceName: r.device?.name || null,
            imagePath: r.snapshotPath || r.imagePath || null, cropPath: m.PlateCrop || null,
            brand: m.Marca || null, color: m.Color || null, type: m.Tipo || null, typeEs: TYPE_ES[m.Tipo] || m.Tipo || null,
            user: r.user?.name || null, unit: r.user?.unit?.name || null,
        };
    });

    return NextResponse.json({
        ok: true, source: "lpr", total: matches.length, truncated: filtered.length >= max,
        range: { from, to }, parsed: { chips: p.chips, unmatched: p.unmatched }, matches,
    }, { headers: { "Cache-Control": "no-store" } });
}
