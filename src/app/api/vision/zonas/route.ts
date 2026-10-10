import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { leerInterruptores } from "@/lib/vision";
import { validarZona } from "@/lib/zona-entrenable";
import { puedeMirar, puedeCambiar, conteos, salida } from "@/lib/zona-entrenable-servidor";

export const dynamic = "force-dynamic";

/** GET /api/vision/zonas — las analíticas entrenables, con su estado, sus conteos y las cámaras para elegir. */
export async function GET() {
    const no = await puedeMirar(); if (no) return no;
    const [zonas, camaras, inter] = await Promise.all([
        prisma.zonaEntrenable.findMany({ orderBy: { createdAt: "asc" } }),
        prisma.device.findMany({ where: { deviceType: { not: "NVR" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
        leerInterruptores(),
    ]);
    const c = await conteos(zonas.map((z) => z.id));
    const nombre = new Map(camaras.map((x) => [x.id, x.name]));
    return NextResponse.json({
        zonas: zonas.map((z) => salida(z, c.get(z.id), nombre.get(z.deviceId))),
        camaras,
        // Apagada en Analíticas (o sin la tarea atributos), el worker no mira ninguna zona: la pantalla lo dice.
        activa: inter.analiticas["zona-entrenable"] !== false,
    }, { headers: { "Cache-Control": "no-store" } });
}

/** POST /api/vision/zonas — crear una. */
export async function POST(req: NextRequest) {
    const { error } = await puedeCambiar(); if (error) return error;
    const { datos, errores } = validarZona(await req.json().catch(() => null));
    if (!datos) return NextResponse.json({ error: errores.join(" · ") }, { status: 400 });
    if (!(await prisma.device.findUnique({ where: { id: datos.deviceId }, select: { id: true } }))) return NextResponse.json({ error: "La cámara no existe." }, { status: 400 });
    const z = await prisma.zonaEntrenable.create({ data: { ...datos, zona: datos.zona as any, horario: (datos.horario as any) ?? undefined, forzarAt: new Date() } });
    return NextResponse.json({ ok: true, id: z.id });
}
