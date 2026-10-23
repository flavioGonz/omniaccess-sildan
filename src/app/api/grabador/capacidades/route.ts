/** GET /api/grabador/capacidades — qué pueden buscar los grabadores dados de alta (texto, imagen). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { conSesion } from "@/lib/acuseek-nvr";
import { grabadoresConBusqueda } from "@/lib/grabador-busqueda";

export async function GET() {
    const no = await conSesion(); if (no) return no;
    const l = await grabadoresConBusqueda().catch(() => []);
    const activos = l.filter((x) => x.cap.activa);
    return NextResponse.json({
        texto: activos.some((x) => x.cap.texto),
        imagen: activos.some((x) => x.cap.imagen),
        grabadores: l.map((x) => ({ id: x.id, nombre: x.nombre, marca: x.marca, motor: x.motor, texto: x.cap.texto, imagen: x.cap.imagen, activa: x.cap.activa, motivo: x.cap.motivo || null })),
    }, { headers: { "Cache-Control": "no-store" } });
}
