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
    const ids = zonas.map((z) => z.id);
    const desde7 = new Date(Date.now() - 7 * 86_400_000), desde24 = new Date(Date.now() - 86_400_000);
    // Lo que hizo cada una, con datos de la base: la tabla los muestra en columnas (Nico, 15/10).
    const [c, ev7, av7, ultimos, m24] = await Promise.all([
        conteos(ids),
        ids.length ? prisma.eventoVision.groupBy({ by: ["reglaId"], where: { tipo: "ZONA", reglaId: { in: ids }, ts: { gte: desde7 } }, _count: { _all: true } }) : [],
        ids.length ? prisma.eventoVision.groupBy({ by: ["reglaId"], where: { tipo: "ZONA", reglaId: { in: ids }, ts: { gte: desde7 }, avisoId: { not: null } }, _count: { _all: true } }) : [],
        ids.length ? prisma.eventoVision.groupBy({ by: ["reglaId"], where: { tipo: "ZONA", reglaId: { in: ids } }, _max: { ts: true } }) : [],
        ids.length ? prisma.muestraZona.groupBy({ by: ["zonaId"], where: { zonaId: { in: ids }, createdAt: { gte: desde24 } }, _count: { _all: true } }) : [],
    ]);
    const cuenta = (l: any[], k: string) => new Map(l.map((x) => [x[k], x._count._all as number]));
    const e7 = cuenta(ev7, "reglaId"), a7 = cuenta(av7, "reglaId"), mu = cuenta(m24, "zonaId");
    const ult = new Map((ultimos as any[]).map((x) => [x.reglaId, x._max.ts as Date | null]));
    const nombre = new Map(camaras.map((x) => [x.id, x.name]));
    return NextResponse.json({
        zonas: zonas.map((z) => ({
            ...salida(z, c.get(z.id), nombre.get(z.deviceId)),
            actividad: { eventos7d: e7.get(z.id) || 0, avisos7d: a7.get(z.id) || 0, ultimoEvento: ult.get(z.id)?.toISOString() || null, muestras24h: mu.get(z.id) || 0 },
        })),
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
