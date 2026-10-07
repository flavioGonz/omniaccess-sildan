import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { limitesDelDia } from "@/lib/fechas";

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
    tipo: "ACCESO" | "PASO" | "ESTACIONADO" | "VISTO";
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
    /** Dónde cayó la chapa dentro del cuadro. Sin esto el visor no puede dibujar la retícula. */
    bbox: string | null;
    estCerrada: boolean;
    estHasta: string | null;
    detalles: string | null;
    /** Solo en las salidas: cuánto estuvo adentro desde su propia entrada. */
    permanencia: number | null;
    /**
     * Solo en las entradas permitidas: cuándo salió ese vehículo después de esta entrada.
     * `null` con `adentro: true` es "sigue adentro" y el contador de la tabla corre en vivo;
     * `adentro: false` sin salida es una entrada vieja a la que nunca se le registró la
     * salida, y ahí no hay nada que contar.
     */
    salida?: string | null;
    adentro?: boolean;
    /** El evento completo, para la ficha. Solo en los accesos. */
    raw: any | null;
};

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Hasta cuánto atrás se busca la entrada de una salida, y hasta cuánto se da por "sigue
 * adentro" una entrada sin salida. Pasado eso lo más probable es que la salida no se haya
 * leído (cámara caída, chapa sucia), y un contador corriendo en 9 días sería una mentira
 * con aire de dato.
 */
const VENTANA_PERMANENCIA_MS = 36 * 3600 * 1000;

/** Una fecha de `<input type="date">` (día entero del barrio) o un instante completo. */
const leerLimite = (v: string | null, extremo: "inicio" | "fin"): Date | null => {
    if (!v) return null;
    const dia = limitesDelDia(v);
    if (dia) return dia[extremo];
    const d = new Date(v);
    return isNaN(+d) ? null : d;
};

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    const sp = req.nextUrl.searchParams;
    const take = Math.min(Number(sp.get("take") || 60), 200);
    const skip = Math.max(Number(sp.get("skip") || 0), 0);
    const buscar = (sp.get("search") || "").trim();
    const desde = leerLimite(sp.get("from"), "inicio");
    const hasta = leerLimite(sp.get("to"), "fin");

    /**
     * Los filtros de acceso: con qué se identificó, si abrió, en qué sentido.
     *
     * La página los tenía como botones desde que se unificó el historial, pero nunca
     * viajaban hasta acá: cambiaban un estado que alimentaba la consulta vieja. Se apretaba
     * "Denegados" y seguían saliendo todos, con el botón encendido.
     */
    const identificacion = sp.get("type") || "ALL";
    const decision = sp.get("decision") || "ALL";
    const sentido = sp.get("direction") || "ALL";

    // Qué tipos se quieren ver. Sin filtro, todos.
    const tipos = (sp.get("tipos") || "").split(",").map((t) => t.trim()).filter(Boolean);
    const quiere = (t: string) => tipos.length === 0 || tipos.includes(t);

    const rango: any = {};
    if (desde && !isNaN(+desde)) rango.gte = desde;
    if (hasta && !isNaN(+hasta)) rango.lte = hasta;
    const porFecha = Object.keys(rango).length ? { timestamp: rango } : {};

    /**
     * Cuántas se le piden a cada tabla.
     *
     * De más, porque cuál aporta cada fila del resultado mezclado no se sabe hasta
     * mezclarlas: si se pidieran `take` a cada una y todas las de la página salieran de
     * una sola, faltarían filas.
     *
     * Y UNA MÁS, que es lo que estaba mal. `hay` se contesta comparando el largo de la
     * lista mezclada contra `skip + take`, pero la lista estaba recortada justo en ese
     * número: con una sola fuente aportando —que es exactamente el caso de este barrio,
     * 108 lecturas interiores y ningún acceso todavía— el largo nunca podía SUPERARLO, y
     * `hay` daba false para siempre. La tabla se plantaba en 60 registros y no había
     * botón ni scroll que trajera el resto, porque desde el servidor no había resto.
     *
     * Pedir una de más es la forma barata de contestar "¿queda algo?" sin contar las dos
     * tablas enteras con los mismos filtros.
     */
    const cuantas = skip + take + 1;

    const pedirAccesos = quiere("ACCESO");

    /**
     * Qué estados de seguimiento entran.
     *
     * Antes eran dos y se resolvia con un ternario: o estacionados, o pasadas. Con VISTO
     * en el medio ese ternario mentia — pedir "vistos" traia pasadas — asi que la lista se
     * arma y se consulta con un `in`, que es lo que la pregunta era desde el principio.
     */
    const estadosPedidos = ["PASO", "ESTACIONADO", "VISTO"].filter(quiere);
    const pedirTrack = estadosPedidos.length > 0;

    const [accesos, avistamientos] = await Promise.all([
        pedirAccesos
            ? prisma.accessEvent.findMany({
                where: {
                    ...porFecha,
                    // Son enums de Prisma; un valor inventado en la URL no rompe la consulta, se ignora.
                    ...(["PLATE", "FACE", "TAG"].includes(identificacion) ? { accessType: identificacion as any } : {}),
                    ...(["GRANT", "DENY"].includes(decision) ? { decision: decision as any } : {}),
                    ...(["ENTRY", "EXIT"].includes(sentido) ? { direction: sentido as any } : {}),
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
                    ...(tipos.length ? { estado: { in: estadosPedidos } } : {}),
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
            bbox: null,
            estCerrada: false,
            estHasta: null,
            detalles: a.details || null,
            permanencia: null,
            raw: a,
        })),
        ...avistamientos.map((s: any): Fila => ({
            id: `s_${s.id}`,
            tipo: s.estado === "ESTACIONADO" ? "ESTACIONADO" : s.estado === "VISTO" ? "VISTO" : "PASO",
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
            bbox: s.bbox || null,
            estCerrada: !!s.estCerrada,
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
        const masVieja = new Date(Math.min(...salidas.map((f) => +new Date(f.momento))) - VENTANA_PERMANENCIA_MS);
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

    /**
     * Tiempo adentro de las entradas: la salida posterior de ese mismo vehículo, si la hubo.
     *
     * Es el dato que alimenta la columna "Tiempo": una entrada sin salida dentro de la
     * ventana cuenta en vivo; con salida, queda quieta en su total. Misma idea que la
     * permanencia pero mirada desde la entrada, y con una sola consulta por página.
     */
    const entradas = pagina.filter((f) => f.tipo === "ACCESO" && f.sentido === "ENTRY" && f.decision !== "DENY" && f.plate);
    if (entradas.length) {
        const chapas = [...new Set(entradas.map((f) => norm(f.plate as string)))];
        const masVieja = new Date(Math.min(...entradas.map((f) => +new Date(f.momento))));
        const salidasPost = await prisma.accessEvent.findMany({
            where: { direction: "EXIT", timestamp: { gte: masVieja }, plateDetected: { in: chapas } },
            orderBy: { timestamp: "asc" },
            select: { plateDetected: true, timestamp: true },
            take: 500,
        });
        const ahora = Date.now();
        for (const f of entradas) {
            const chapa = norm(f.plate as string);
            const entro = +new Date(f.momento);
            const salio = salidasPost.find((e) => norm(e.plateDetected || "") === chapa && +e.timestamp > entro);
            if (salio) { f.salida = salio.timestamp.toISOString(); f.adentro = false; }
            else { f.salida = null; f.adentro = ahora - entro <= VENTANA_PERMANENCIA_MS; }
        }
    }

    // `hay` dice si conviene pedir otra página: sobró al menos una de las que se pidieron
    // de más. Un total exacto exigiría contar las dos tablas con los mismos filtros y no
    // cambia nada de lo que se puede hacer con el resultado.
    return NextResponse.json({
        filas: pagina,
        hay: filas.length > skip + take,
        enPagina: pagina.length,
    });
}
