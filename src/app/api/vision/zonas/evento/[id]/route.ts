import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { puedeMirar, imagen } from "@/lib/zona-entrenable-servidor";
import { cambioDeEstado, tiraDelCambio, poligonoValido } from "@/lib/zona-evento";

export const dynamic = "force-dynamic";

/** Hasta cuánto antes del aviso se busca el cambio: un vigía fuera de horario puede llevar toda la noche en ese estado. */
const HISTORIA_MS = 24 * 3600_000;
const MUESTRAS_MAX = 800;

/**
 * GET /api/vision/zonas/evento/<id del EventoVision>
 *
 * Lo que la ficha de la alarma necesita de un aviso de analítica entrenable (14/11, Nico: «debés
 * resaltar el objeto detectado… no sé cuándo fue que se llenó»): dónde está la zona en la foto,
 * entre qué dos miradas cambió de estado (ver lib/zona-evento), las miradas que cuentan esa
 * historia, y cómo está AHORA. 404 si el evento no es de una analítica entrenable: la ficha
 * pregunta por cualquier aviso de OmniVision y con eso sabe que no hay nada que dibujar.
 *
 * El polígono es el que tenía la zona al avisar (el worker lo guarda en el aviso desde el 14/11);
 * en los avisos anteriores es el de HOY, y se dice (`poligonoDeHoy`), porque pudo redibujarse.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const no = await puedeMirar(); if (no) return no;
    const { id } = await params;
    const ev = await prisma.eventoVision.findUnique({ where: { id }, select: { id: true, tipo: true, reglaId: true, ts: true, valor: true, avisoId: true } });
    if (!ev || ev.tipo !== "ZONA") return NextResponse.json({ error: "No es un evento de analítica entrenable." }, { status: 404 });
    const [z, aviso] = await Promise.all([
        prisma.zonaEntrenable.findUnique({ where: { id: ev.reglaId }, select: { id: true, nombre: true, positivo: true, negativo: true, zona: true, umbral: true, sostenerSeg: true, cadaSeg: true, estado: true, activa: true } }),
        ev.avisoId ? prisma.avisoGuardia.findUnique({ where: { id: ev.avisoId }, select: { datos: true } }).catch(() => null) : null,
    ]);
    if (!z) return NextResponse.json({ error: "La analítica de este aviso ya no existe." }, { status: 404 });
    const d = (aviso?.datos || {}) as Record<string, unknown>;
    const delAviso = poligonoValido(d.poligono);
    const poligono = delAviso || poligonoValido(z.zona);
    const umbral = typeof d.umbral === "number" ? d.umbral : z.umbral;

    const t = ev.ts.getTime();
    const filas = await prisma.muestraZona.findMany({
        where: { zonaId: z.id, createdAt: { gte: new Date(t - HISTORIA_MS), lte: new Date(t + 5000) } },
        orderBy: { createdAt: "desc" }, take: MUESTRAS_MAX,
        select: { id: true, createdAt: true, prob: true, recorte: true, etiqueta: true },
    });
    const muestras = filas.map((m) => ({ id: m.id, ts: m.createdAt.getTime(), prob: m.prob, recorte: m.recorte, etiqueta: m.etiqueta }));
    const c = cambioDeEstado(muestras, umbral, t);
    const tira = tiraDelCambio(muestras, c).map((m) => ({ id: m.id, ts: new Date(m.ts).toISOString(), prob: m.prob, url: imagen(m.recorte), etiqueta: m.etiqueta, rol: m.rol }));
    // Sin muestras (vencen a los 14 días si nadie las etiquetó), lo que el worker dejó anotado en el aviso.
    const iso = (x: unknown) => (typeof x === "string" && !Number.isNaN(Date.parse(x)) ? x : null);
    const desde = c.desde ? new Date(c.desde.ts).toISOString() : iso(d.positivoDesde);
    const antes = c.antes ? new Date(c.antes.ts).toISOString() : c.desde ? null : iso(d.normalHasta);

    const e = (z.estado || {}) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo, como en zona-entrenable-servidor
    const s: any = await getSession().catch(() => null);
    return NextResponse.json({
        zona: { id: z.id, nombre: z.nombre, positivo: z.positivo, negativo: z.negativo, poligono, poligonoDeHoy: !delAviso, umbral, sostenerSeg: z.sostenerSeg, cadaSeg: z.cadaSeg, activa: z.activa },
        evento: { ts: ev.ts.toISOString(), prob: ev.valor, muestraId: c.evento && Math.abs(c.evento.ts - t) <= 30_000 ? c.evento.id : null, etiqueta: c.evento ? muestras.find((m) => m.id === c.evento!.id)?.etiqueta ?? null : null },
        cambio: { antes, desde },
        tira,
        ahora: typeof e.prob === "number" && iso(e.al) ? { prob: e.prob, al: iso(e.al), positivo: e.prob >= z.umbral, desde: iso(e.positivoDesde) } : null,
        puedeEnsenar: !!s && permisosDeSesion(s).includes("vision.config"),
    }, { headers: { "Cache-Control": "no-store" } });
}
