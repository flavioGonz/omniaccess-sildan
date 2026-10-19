import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { normalizarMatricula } from "@/lib/lista-negra";
import { normalizeWatchCat } from "@/lib/watch-categories";
import { esNoLeida, relecturasDe } from "@/lib/relectura";
import { empresasDeLecturas } from "@/lib/empresas-servidor";
import { leerAjustesVisitas } from "@/lib/visitas/ajustes";
import { getImagePath } from "@/lib/image-path";
import { ZONA } from "@/lib/fechas";
import { claseDe } from "@/lib/visitas/calculos";

export const dynamic = "force-dynamic";

/**
 * El comportamiento de la chapa: sus pasos por la barrera y cuándo se la ve, en los últimos
 * COMPORTAMIENTO_DIAS días (los mismos que la ficha de Control LPR). Hasta PASOS_MAX pasos:
 * más no entran en el panel y un vehículo que pasa 200 veces en un mes ya dijo lo que es.
 */
const COMPORTAMIENTO_DIAS = 30;
const PASOS_MAX = 200;
/** Una visita cuenta para la lectura si estaba abierta a esa hora, con este margen (la garita la carga antes o después). */
const MARGEN_VISITA_MS = 30 * 60_000;

/**
 * GET /api/history/ficha?evento=<id>&plate=<chapa>&momento=<iso>
 *
 * La ficha de una lectura del historial, para el visor. Antes se armaba en el navegador con lo
 * que traía la fila, y eso mentía de dos maneras:
 *
 *   - La marca que la CÁMARA creyó reconocer («Brand 1723») entraba como si fuera del padrón, y
 *     el visor decía «En el padrón» con tilde verde… sobre una NO_LEIDA.
 *   - Del dueño sólo había el nombre: lote, teléfono y cochera salían «Sin unidad», «Sin
 *     teléfono», aunque estuvieran cargados.
 *
 * Acá se consulta el padrón de verdad: el vehículo, quién recibió el acceso (o el dueño del
 * vehículo o de la credencial), con lote, teléfono y cochera; la lista de vigilancia; y la
 * visita que estaba abierta a esa hora (a qué lote iba).
 *
 * Y si la cámara no leyó la chapa pero OmniVision la releyó, la ficha es la de la chapa releída
 * (`porRelectura`): es lo que el guardia necesita para saber a qué lote iba, dicho como
 * sugerencia. Con el evento vienen también el análisis de OmniVision (siluetas, atributos) y
 * la empresa con su logo.
 */
/**
 * El perfil armado con los pasos, cuando la chapa no tiene PerfilMatricula (19/10, Nico: «los
 * datos de esa tabla comportamiento nunca se llenan»). Los perfiles los calcula la tarea «Visitas
 * y patrones» cada 10 minutos, y una chapa nueva —o una instancia donde la tarea no corre, como
 * el lab— quedaba con clase, días, primera y última vez en «—» aunque los pasos estuvieran a la
 * vista. Esto da lo que se puede contar sin la tarea: días con pasos, entradas y salidas, primera
 * vez (la de siempre) y última, y la clase sin rutina (ésa la detecta la tarea). La permanencia la
 * calcula el panel con las estadías.
 */
function perfilDePasos(pasos: { timestamp: Date; direction: string | null }[], primera: Date | null, enPadron: boolean) {
    if (!pasos.length) return null;
    const dia = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: ZONA });
    const dias = new Set(pasos.map((p) => dia(p.timestamp))).size;
    const ms = pasos.map((p) => +p.timestamp);
    return {
        clase: claseDe({ enPadron, rutina: null, diasVistos: dias }), diasVistos: dias,
        entradas: pasos.filter((p) => p.direction === "ENTRY").length, salidas: pasos.filter((p) => p.direction === "EXIT").length,
        primeraVez: (primera || new Date(Math.min(...ms))).toISOString(), ultimaVez: new Date(Math.max(...ms)).toISOString(),
        permanenciaMedianaMin: null, permanenciaP90Min: null,
        /** No es el perfil de la tarea: el panel lo dice. */
        estimado: true,
    };
}

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();
    const sp = req.nextUrl.searchParams;
    const eventoId = sp.get("evento") || "";
    const momento = new Date(sp.get("momento") || Date.now());
    let plate = normalizarMatricula(sp.get("plate"));

    const [evento, analisis, relecturas] = eventoId ? await Promise.all([
        prisma.accessEvent.findUnique({ where: { id: eventoId }, select: { userId: true, deviceId: true, location: true, device: { select: { name: true } } } }).catch(() => null),
        prisma.analisisFoto.findUnique({ where: { accessEventId: eventoId }, select: { estado: true, analisis: true } }).catch(() => null),
        relecturasDe([eventoId], (clave) => `/api/vision/imagen/${clave}`).catch(() => new Map()),
    ]) : [null, null, new Map()];
    const relectura = relecturas.get(eventoId) || null;

    // NO_LEIDA releída por OmniVision: la ficha sale de la chapa sugerida (si es LEIDA o DUDOSA).
    let porRelectura = false;
    if ((!plate || esNoLeida(plate)) && relectura?.plate && (relectura.estado === "LEIDA" || relectura.estado === "DUDOSA")) {
        plate = normalizarMatricula(relectura.plate);
        porRelectura = true;
    }
    const conChapa = !!plate && !esNoLeida(plate);

    const SEL_USUARIO = { id: true, name: true, phone: true, apartment: true, role: true, unit: { select: { name: true } }, parkingSlot: { select: { label: true } } } as const;
    const [vehiculo, credencial, usuarioEvento, vigilancia, visitas] = conChapa ? await Promise.all([
        prisma.vehicle.findFirst({ where: { plate }, select: { brand: true, model: true, color: true, type: true, user: { select: SEL_USUARIO } } }).catch(() => null),
        prisma.credential.findFirst({ where: { type: "PLATE", value: plate }, select: { user: { select: SEL_USUARIO } } }).catch(() => null),
        // Quién recibió el acceso manda, salvo si la ficha es de una relectura (el evento no lo tenía).
        evento?.userId && !porRelectura ? prisma.user.findUnique({ where: { id: evento.userId }, select: SEL_USUARIO }).catch(() => null) : null,
        prisma.plateWatch.findFirst({ where: { plate, active: true }, select: { label: true, category: true, color: true } }).catch(() => null),
        prisma.visita.findMany({
            where: { plate, entra: { lte: new Date(+momento + MARGEN_VISITA_MS) } }, orderBy: { entra: "desc" }, take: 5,
            select: { tipo: true, loteNombre: true, nombre: true, empresa: true, entra: true, vence: true, sale: true },
        }).catch(() => []),
    ]) : [null, null, null, null, []];

    const u = usuarioEvento || vehiculo?.user || credencial?.user || null;
    const v = (visitas as any[]).find((x) => (x.sale ? +x.sale : Date.now()) >= +momento - MARGEN_VISITA_MS) || null;
    const tipos = v ? (await leerAjustesVisitas().catch(() => null))?.tipos : null;
    const empresa = conChapa ? (await empresasDeLecturas([{ clave: "x", plate, momento }]).catch(() => new Map())).get("x") || null : null;

    const ficha = (vehiculo || u || vigilancia || v) ? {
        marca: vehiculo?.brand || null, modelo: vehiculo?.model || null, color: vehiculo?.color || null, tipo: vehiculo?.type || null,
        dueno: u ? {
            id: u.id, nombre: u.name, telefono: u.phone || null, unidad: u.unit?.name || null,
            apartamento: u.apartment || null, cochera: u.parkingSlot?.label || null, rol: String(u.role),
        } : null,
        vigilancia: vigilancia ? { etiqueta: vigilancia.label, categoria: normalizeWatchCat(vigilancia.category) || vigilancia.category, color: vigilancia.color } : null,
        visita: v ? {
            tipo: tipos?.find((t) => t.clave === v.tipo)?.nombre || v.tipo, lote: v.loteNombre, nombre: v.nombre, empresa: v.empresa,
            entra: v.entra.toISOString(), vence: v.vence.toISOString(), sale: v.sale ? v.sale.toISOString() : null,
        } : null,
    } : null;

    const an = analisis?.estado === "OK" ? (analisis.analisis as any) : null;

    // El comportamiento: los pasos (con foto, para la tira) y la franja día × hora (para el mapa de calor).
    const desdeComp = new Date(Date.now() - COMPORTAMIENTO_DIAS * 86_400_000);
    const [pasos, franjaFilas, perfil, primerPaso] = conChapa ? await Promise.all([
        prisma.accessEvent.findMany({
            where: { plateDetected: plate, timestamp: { gte: desdeComp } }, orderBy: { timestamp: "desc" }, take: PASOS_MAX,
            select: { id: true, timestamp: true, direction: true, decision: true, snapshotPath: true, imagePath: true, location: true, device: { select: { name: true } } },
        }).catch(() => []),
        prisma.$queryRaw<{ dow: number; h: number; n: number }[]>`
            SELECT extract(isodow FROM (timestamp AT TIME ZONE 'UTC' AT TIME ZONE ${ZONA}))::int AS dow,
                   extract(hour FROM (timestamp AT TIME ZONE 'UTC' AT TIME ZONE ${ZONA}))::int AS h, count(*)::int AS n
              FROM "AccessEvent"
             WHERE "plateDetected" = ${plate} AND timestamp >= now() - (${String(COMPORTAMIENTO_DIAS)} || ' days')::interval
             GROUP BY 1, 2`.catch(() => []),
        prisma.perfilMatricula.findUnique({ where: { plate } }).catch(() => null),
        prisma.accessEvent.findFirst({ where: { plateDetected: plate }, orderBy: { timestamp: "asc" }, select: { timestamp: true } }).catch(() => null),
    ]) : [[], [], null, null];
    const franja = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
    for (const f of franjaFilas as any[]) if (f.dow >= 1 && f.dow <= 7 && f.h >= 0 && f.h < 24) franja[f.dow - 1][f.h] = f.n;
    const comportamiento = conChapa ? {
        dias: COMPORTAMIENTO_DIAS,
        pasos: (pasos as any[]).map((x) => ({
            id: x.id, momento: x.timestamp.toISOString(), direccion: x.direction, decision: x.decision,
            camara: x.device?.name || x.location || null, foto: getImagePath(x.snapshotPath || x.imagePath) || null,
            actual: x.id === eventoId,
        })),
        franja,
        perfil: perfil ? {
            clase: perfil.clase, diasVistos: perfil.diasVistos, entradas: perfil.entradas, salidas: perfil.salidas,
            primeraVez: perfil.primeraVez.toISOString(), ultimaVez: perfil.ultimaVez.toISOString(),
            permanenciaMedianaMin: perfil.permanenciaMedianaMin, permanenciaP90Min: perfil.permanenciaP90Min,
        } : perfilDePasos(pasos as any[], primerPaso?.timestamp || null, !!u),
    } : null;
    return NextResponse.json({
        // La cámara del evento: hay pantallas que mandan el evento sin el equipo incluido (las
        // lecturas de una LPR interior en el monitor), y el visor decía «Cámara desconocida».
        camara: (evento as any)?.device?.name || (evento as any)?.location || null, deviceId: (evento as any)?.deviceId || null,
        plate: conChapa ? plate : null,
        porRelectura,
        ficha,
        vision: an?.ancho && an?.alto ? { ancho: an.ancho, alto: an.alto, objetos: an.objetos || [] } : null,
        relectura,
        empresa,
        comportamiento,
    }, { headers: { "Cache-Control": "no-store" } });
}
