import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validarSolicitud } from "@/lib/registro-padron";
import { exigirFuncion } from "@/lib/funcion-servidor";

export const dynamic = "force-dynamic";

/**
 * POST /api/registro — el censo del barrio, desde el QR (src/lib/registro-padron.ts).
 *
 * Es la ÚNICA ruta de la aplicación que escribe sin sesión, así que tiene las defensas escritas
 * acá y a la vista:
 *
 *  · El cuerpo tiene tope: lo que manda el formulario entra en unos pocos kilobytes.
 *  · Hay un balde por dirección: cinco cargas cada diez minutos. Una familia que se equivoca y
 *    vuelve a mandar entra; un script que repite, no.
 *  · Lo que llega NO es padrón: es una solicitud pendiente. Nada abre un portón hasta que alguien
 *    la aprueba desde el panel.
 *  · No contesta NADA sobre lo que ya hay. Ni cuántos lotes van, ni si ese lote ya cargó, ni un
 *    apellido. Son datos de trescientas familias detrás de un QR público: el formulario escribe,
 *    no consulta.
 */

const CUERPO_MAX = 16 * 1024;
const POR_DIRECCION = 5;
const VENTANA_MS = 10 * 60 * 1000;
/** Dos envíos iguales del mismo lote en este rato son el mismo: el botón tocado dos veces. */
const REPETIDO_MS = 10 * 60 * 1000;

const baldes = new Map<string, { n: number; desde: number }>();
function hayCupo(quien: string): boolean {
    const ahora = Date.now();
    const b = baldes.get(quien);
    if (!b || ahora - b.desde > VENTANA_MS) { baldes.set(quien, { n: 1, desde: ahora }); limpiar(ahora); return true; }
    if (b.n >= POR_DIRECCION) return false;
    b.n++;
    return true;
}
function limpiar(ahora: number) {
    if (baldes.size < 5000) return;
    for (const [k, v] of baldes) if (ahora - v.desde > VENTANA_MS) baldes.delete(k);
}

export async function POST(req: NextRequest) {
    // Con la función apagada esta dirección no existe: 404, como la página.
    const no = await exigirFuncion("PADRON_CENSO"); if (no) return no;
    const quien = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "sin-direccion";
    if (!hayCupo(quien)) {
        return NextResponse.json({ error: "Ya mandaste varias cargas seguidas. Esperá unos minutos." }, { status: 429, headers: { "Retry-After": "600" } });
    }
    const crudo = await req.text().catch(() => "");
    if (crudo.length > CUERPO_MAX) return NextResponse.json({ error: "El formulario llegó demasiado grande." }, { status: 413 });

    let cuerpo: unknown = null;
    try { cuerpo = JSON.parse(crudo); } catch { return NextResponse.json({ error: "No se entendió el formulario." }, { status: 400 }); }

    const { datos, errores } = validarSolicitud(cuerpo);
    if (!datos) return NextResponse.json({ errores }, { status: 400 });

    try {
        // El botón tocado dos veces no es una familia que cargó dos veces.
        const igual = await prisma.solicitudPadron.findFirst({
            where: { lote: datos.lote, telefono: datos.telefono, estado: "pendiente", createdAt: { gte: new Date(Date.now() - REPETIDO_MS) } },
            select: { id: true },
        });
        if (igual) {
            await prisma.solicitudPadron.update({ where: { id: igual.id }, data: { ...datos, vehiculos: datos.vehiculos, servicios: datos.servicios } });
            return NextResponse.json({ ok: true, id: igual.id, repetido: true });
        }
        const fila = await prisma.solicitudPadron.create({ data: { ...datos, vehiculos: datos.vehiculos, servicios: datos.servicios } });
        return NextResponse.json({ ok: true, id: fila.id });
    } catch {
        return NextResponse.json({ error: "No se pudo guardar. Probá de nuevo en un momento." }, { status: 503 });
    }
}
