export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor, SIN_CACHE } from "@/lib/monitor/servidor";
import { getImagePath } from "@/lib/image-path";
import { leerRecuadro } from "@/lib/deteccion";
import { chapaDelEvento, leerChapas } from "@/lib/lector-chapas";

/**
 * GET /api/monitor/camaras/chapa-foto?evento=<id> → { plate, caja: [x1,y1,x2,y2] } | { caja: null }
 *
 * Dónde está la matrícula en la captura de una lectura, en fracciones de la foto (16/11, Nico,
 * mirando una captura abierta desde el vivo: «debés resaltar la matrícula también»).
 *
 * De dónde sale, en este orden:
 *  1. Del avistamiento del evento, si guardó la caja de la chapa: es la que vio el motor, gratis.
 *     Medido ese día: la tienen 5 de las últimas 200 lecturas, así que casi siempre se pasa a…
 *  2. …leer la foto otra vez. La captura de una cámara de acceso tiene la chapa grande, y lo que
 *     se busca es dónde está, no qué dice: el texto que se muestra sigue siendo el del evento.
 *
 * Lo leído se recuerda un rato: la misma captura se abre y se cierra varias veces, y cada lectura
 * ocupa al lector, que es uno solo y lo comparte con el motor.
 */
const RECUERDO_MAX = 200;
const RECUERDO_MS = 30 * 60_000;
type Respuesta = { plate: string | null; caja: [number, number, number, number] | null };
const recuerdo = new Map<string, { hasta: number; r: Respuesta }>();

export async function GET(req: NextRequest) {
    const p = await autorizarMonitor("/api/monitor/camaras/chapa-foto");
    if (p.error) return p.error;
    const id = (req.nextUrl.searchParams.get("evento") || "").slice(0, 60);
    if (!/^[\w-]{6,60}$/.test(id)) return NextResponse.json({ error: "falta el evento" }, { status: 400, headers: SIN_CACHE });

    const guardado = recuerdo.get(id);
    if (guardado && guardado.hasta > Date.now()) return NextResponse.json(guardado.r, { headers: SIN_CACHE });

    const contestar = (r: Respuesta) => {
        if (recuerdo.size > RECUERDO_MAX) for (const [k, v] of recuerdo) if (v.hasta < Date.now() || recuerdo.size > RECUERDO_MAX) recuerdo.delete(k);
        recuerdo.set(id, { hasta: Date.now() + RECUERDO_MS, r });
        return NextResponse.json(r, { headers: SIN_CACHE });
    };

    try {
        const ev = await prisma.accessEvent.findUnique({ where: { id }, select: { plateDetected: true, snapshotPath: true, imagePath: true } });
        if (!ev) return NextResponse.json({ error: "no existe" }, { status: 404, headers: SIN_CACHE });
        const plate = ev.plateDetected || null;

        // 1. La caja que ya guardó el avistamiento de ese evento.
        const s = await prisma.plateSighting.findUnique({ where: { accessEventId: id }, select: { bbox: true, plate: true } }).catch(() => null);
        const r = leerRecuadro(s?.bbox);
        if (r) return contestar({ plate: plate || s?.plate || null, caja: [r.x, r.y, r.x + r.w, r.y + r.h] });

        // 2. Leer la foto. Se pide por la propia aplicación, igual que la pantalla: la ruta de
        //    archivos ya sabe de qué depósito sacarla y con qué nombre quedó guardada.
        const ruta = getImagePath(ev.snapshotPath || ev.imagePath);
        if (!ruta) return contestar({ plate, caja: null });
        const foto = await fetch(new URL(ruta, req.nextUrl.origin), { headers: { cookie: req.headers.get("cookie") || "" }, signal: AbortSignal.timeout(10_000) });
        if (!foto.ok) return contestar({ plate, caja: null });
        const jpeg = Buffer.from(await foto.arrayBuffer());
        if (jpeg.length < 1000) return contestar({ plate, caja: null });

        // El lector devuelve píxeles de la foto que se le mandó; acá viajan en fracciones.
        const sharp = (await import("sharp")).default;
        const m = await sharp(jpeg).metadata();
        const W = m.width || 0, H = m.height || 0;
        if (!W || !H) return contestar({ plate, caja: null });
        const c = chapaDelEvento(await leerChapas(jpeg), plate);
        if (!c) return contestar({ plate, caja: null });
        return contestar({ plate: c.texto || plate, caja: [c.caja.x1 / W, c.caja.y1 / H, c.caja.x2 / W, c.caja.y2 / H] });
    } catch (e) {
        console.error("[chapa-foto]", e instanceof Error ? e.message : e);
        return NextResponse.json({ plate: null, caja: null }, { headers: SIN_CACHE });
    }
}
