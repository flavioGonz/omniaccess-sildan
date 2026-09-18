import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/history/unified
 *
 * Accesos y avistamientos en una sola lista, ordenados por momento.
 *
 * Estaban en dos tablas separadas porque son cosas distintas: un acceso decide si la
 * barrera abre, un avistamiento solo deja constancia. Esa diferencia sigue importando y
 * por eso cada fila dice de qué tipo es — pero tenerlas separadas obligaba a buscar la
 * misma matrícula dos veces, en dos pantallas, para reconstruir un solo recorrido.
 *
 * Se consultan las dos tablas por separado y se mezclan acá. No se hace en SQL con un
 * UNION porque los campos no se corresponden uno a uno (decisión y sentido de un lado,
 * confianza y estadía del otro), y forzarlos a un molde común los volvería mentirosos.
 */

type Fila = {
    id: string;
    tipo: "ACCESO" | "PASO" | "ESTACIONADO";
    momento: string;
    plate: string | null;
    persona: string | null;
    camara: string | null;
    deviceId: string | null;
    /** Acceso: GRANT | DENY. Avistamiento: null. */
    decision: string | null;
    /** ENTRY | EXIT | INTERNAL */
    sentido: string | null;
    confianza: number | null;
    lecturas: number | null;
    foto: string | null;
    estDesde: string | null;
    estHasta: string | null;
    detalles: string | null;
    /** Solo en las salidas: cuánto estuvo adentro desde su propia entrada. */
    permanencia: number | null;
    /** El evento completo, para la ficha. Solo en los accesos. */
    raw: any | null;
};

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    const sp = req.nextUrl.searchParams;
    const take = Math.min(Number(sp.get("take") || 60), 200);
    const skip = Math.max(Number(sp.get("skip") || 0), 0);
    const buscar = (sp.get("search") || "").trim();
    const desde = sp.get("from") ? new Date(sp.get("from") as string) : null;
    const hasta = sp.get("to") ? new Date(sp.get("to") as string) : null;

    // Qué tipos se quieren ver. Sin filtro, todos.
    const tipos = (sp.get("tipos") || "").split(",").map((t) => t.trim()).filter(Boolean);
    const quiere = (t: string) => tipos.length === 0 || tipos.includes(t);

    const rango: any = {};
    if (desde && !isNaN(+desde)) rango.gte = desde;
    if (hasta && !isNaN(+hasta)) rango.lte = hasta;
    const porFecha = Object.keys(rango).length ? { timestamp: rango } : {};

    // Se pide de más a cada tabla (skip + take) porque cuál aporta cada fila del
    // resultado mezclado no se sabe hasta mezclarlas.
    const cuantas = skip + take;

    const pedirAccesos = quiere("ACCESO");
    const pedirTrack = quiere("PASO") || quiere("ESTACIONADO");

    const [accesos, avistamientos] = await Promise.all([
        pedirAccesos
            ? prisma.accessEvent.findMany({
                where: {
                    ...porFecha,
                    ...(buscar
                        ? {
                            OR: [
                                { plateDetected: { contains: buscar, mode: "insensitive" } },
                                { plateNumber: { contains: buscar, mode: "insensitive" } },
                                { location: { contains: buscar, mode: "insensitive" } },
                                { user: { name: { contains: buscar, mode: "insensitive" } } },
                            ],
                        }
                        : {}),
                },
                orderBy: { timestamp: "desc" },
                take: cuantas,
                include: { user: { select: { name: true } }, device: { select: { name: true } } },
            })
            : Promise.resolve([] as any[]),
        pedirTrack
            ? prisma.plateSighting.findMany({
                where: {
                    source: "TRACK",
                    ...porFecha,
                    ...(tipos.length && !(quiere("PASO") && quiere("ESTACIONADO"))
                        ? { estado: quiere("ESTACIONADO") ? "ESTACIONADO" : "PASO" }
                        : {}),
                    ...(buscar
                        ? {
                            OR: [
                                { plate: { contains: buscar, mode: "insensitive" } },
                                { cameraName: { contains: buscar, mode: "insensitive" } },
                            ],
                        }
                        : {}),
                },
                orderBy: { timestamp: "desc" },
                take: cuantas,
            })
            : Promise.resolve([] as any[]),
    ]);

    const filas: Fila[] = [
        ...accesos.map((a: any): Fila => ({
            id: `a_${a.id}`,
            tipo: "ACCESO",
            momento: a.timestamp.toISOString(),
            plate: a.plateDetected || a.plateNumber || null,
            persona: a.user?.name || null,
            camara: a.device?.name || a.location || null,
            deviceId: a.deviceId || null,
            decision: a.decision || null,
            sentido: a.direction || null,
            confianza: null,
            lecturas: null,
            foto: a.snapshotPath || a.imagePath || null,
            estDesde: null,
            estHasta: null,
            detalles: a.details || null,
            permanencia: null,
            raw: a,
        })),
        ...avistamientos.map((s: any): Fila => ({
            id: `s_${s.id}`,
            tipo: s.estado === "ESTACIONADO" ? "ESTACIONADO" : "PASO",
            momento: s.timestamp.toISOString(),
            plate: s.plate,
            persona: null,
            camara: s.cameraName || s.deviceId || null,
            deviceId: s.deviceId || null,
            decision: null,
            sentido: s.eventType || "INTERNAL",
            confianza: s.confidence ?? null,
            lecturas: s.reads ?? null,
            foto: s.snapshotUrl || null,
            estDesde: s.estDesde ? s.estDesde.toISOString() : null,
            estHasta: s.estHasta ? s.estHasta.toISOString() : null,
            detalles: null,
            permanencia: null,
            raw: null,
        })),
    ];

    filas.sort((a, b) => b.momento.localeCompare(a.momento));
    const pagina = filas.slice(skip, skip + take);

    /**
     * Permanencia de las salidas: cuánto estuvo adentro ese mismo vehículo.
     *
     * Se calcula solo para las salidas de ESTA página y con UNA consulta, no una por
     * fila. Antes salía de tener todos los eventos cargados en el navegador, que dejó de
     * ser cierto al paginar: mirar la página siguiente no puede cambiar el dato.
     */
    const salidas = pagina.filter((f) => f.tipo === "ACCESO" && f.sentido === "EXIT" && f.plate);
    if (salidas.length) {
        const chapas = [...new Set(salidas.map((f) => norm(f.plate as string)))];
        const masVieja = new Date(Math.min(...salidas.map((f) => +new Date(f.momento))) - 36 * 3600 * 1000);
        const entradas = await prisma.accessEvent.findMany({
            where: { direction: "ENTRY", timestamp: { gte: masVieja }, plateDetected: { in: chapas } },
            orderBy: { timestamp: "desc" },
            select: { plateDetected: true, timestamp: true },
            take: 500,
        });
        for (const f of salidas) {
            const chapa = norm(f.plate as string);
            const salio = +new Date(f.momento);
            const entro = entradas.find((e) => norm(e.plateDetected || "") === chapa && +e.timestamp < salio);
            if (entro) f.permanencia = Math.round((salio - +entro.timestamp) / 1000);
        }
    }

    // `hay` dice si conviene pedir otra página. Un total exacto exigiría contar las dos
    // tablas con los mismos filtros y no cambia nada de lo que se puede hacer.
    return NextResponse.json({
        filas: pagina,
        hay: filas.length > skip + take,
        enPagina: pagina.length,
    });
}
