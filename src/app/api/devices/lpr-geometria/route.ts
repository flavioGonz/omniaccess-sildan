/**
 * /api/devices/lpr-geometria?deviceId=…  — carriles, zonas de captura y líneas de cruce de la
 * lectura de OmniVision (26/11, lib-geometria-lpr.js).
 *
 *  GET → { ok, geometria, roi, linea, puntos }
 *        `puntos`: dónde cayeron las chapas leídas en las últimas 48 h (centro del recuadro), para
 *        dibujar los carriles encima de donde de verdad pasan los autos. `roi` y `linea`: la zona
 *        y la línea del calibrador de lectura, para que se vea con qué conviven.
 *  PUT { geometria } → la guarda normalizada. El worker la toma en el minuto (sin reiniciar).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { prisma } from "@/lib/prisma";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const geo = require("../../../../../lib-geometria-lpr.js");

export const dynamic = "force-dynamic";
const SIN_CACHE = { "Cache-Control": "no-store" };
const VENTANA_MS = 48 * 3600_000, MAX_PUNTOS = 500;

const json = <T,>(s: string | null | undefined): T | null => { try { return s ? JSON.parse(s) as T : null; } catch { return null; } };

export async function GET(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ ok: false, error: "Hace falta una sesión del panel." }, { status: 401 });
    const id = req.nextUrl.searchParams.get("deviceId") || "";
    const d = await prisma.device.findUnique({ where: { id }, select: { id: true, lprGeometria: true, trackRoi: true, trackLine: true, trackTrigger: true } });
    if (!d) return NextResponse.json({ ok: false, error: "El equipo no existe." }, { status: 404 });
    const roi = json<{ x: number; y: number; w: number; h: number }>(d.trackRoi);
    const filas = await prisma.plateSighting.findMany({
        where: { deviceId: id, timestamp: { gte: new Date(Date.now() - VENTANA_MS) }, bbox: { not: null } },
        select: { bbox: true, estado: true }, orderBy: { timestamp: "desc" }, take: MAX_PUNTOS,
    });
    const puntos = filas.map((f) => {
        const b = json<{ x: number; y: number; w: number; h: number; ar?: number }>(f.bbox);
        if (!b || !Number.isFinite(b.x)) return null;
        const r = geo.aCuadroEntero(b, roi);
        return { x: +(r.x + r.w / 2).toFixed(4), y: +(r.y + r.h / 2).toFixed(4), quieto: f.estado !== "PASO" };
    }).filter(Boolean);
    return NextResponse.json({
        ok: true,
        geometria: geo.normalizar(json(d.lprGeometria)) || { v: 1, activa: true, rebote: geo.REBOTE_DEF, carriles: [], zonas: [], lineas: [] },
        guardada: !!d.lprGeometria,
        roi, linea: d.trackTrigger === "linea" ? json(d.trackLine) : null, puntos,
    }, { headers: SIN_CACHE });
}

export async function PUT(req: NextRequest) {
    const s: any = await getSession();
    if (!s) return NextResponse.json({ ok: false, error: "Hace falta una sesión del panel." }, { status: 401 });
    const { permisosDeSesion } = await import("@/lib/permisos");
    if (!permisosDeSesion(s).includes("dispositivos.editar")) return NextResponse.json({ ok: false, error: "Hace falta el permiso Editar dispositivos." }, { status: 403 });
    const id = req.nextUrl.searchParams.get("deviceId") || "";
    const d = await prisma.device.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!d) return NextResponse.json({ ok: false, error: "El equipo no existe." }, { status: 404 });
    const b = await req.json().catch(() => ({}));
    const g = geo.normalizar(b?.geometria);
    if (!g) return NextResponse.json({ ok: false, error: "La geometría no es válida." }, { status: 400 });
    const vacia = !g.carriles.length && !g.zonas.length && !g.lineas.length;
    await prisma.device.update({ where: { id }, data: { lprGeometria: vacia ? null : JSON.stringify(g) } });
    await prisma.accionSistema.create({ data: { quien: String(s.name || s.sub || "panel"), accion: "equipos.lpr-geometria", objetivo: d.name, ok: true,
        detalle: vacia ? "sin geometría: vuelve la compuerta de siempre" : `${g.activa ? "activa" : "apagada"} · ${g.carriles.length} carriles · ${g.zonas.length} zonas · ${g.lineas.length} líneas · rebote ${g.rebote} s` } }).catch(() => { });
    return NextResponse.json({ ok: true, geometria: g, guardada: !vacia }, { headers: SIN_CACHE });
}
