import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor, inicioDelDia, SIN_CACHE } from "@/lib/monitor/servidor";
import { normalizarMatricula } from "@/lib/lista-negra";
import { formaLectura as forma, INCLUIR_LECTURA } from "@/lib/monitor/lecturas";
import { leerAjustesVisitas } from "@/lib/visitas/ajustes";
import { registradas } from "@/lib/visitas/registro";
import { logosDeMatriculas } from "@/lib/empresas-servidor";

export const dynamic = "force-dynamic";

/**
 * Cuántas lecturas van en la tira, además de la protagonista. Eran 10, todas a la vista y sin
 * poder moverse: con la pantalla táctil la tira se desliza y se filtra (entradas, salidas,
 * denegadas), y diez no alcanzan para que un filtro muestre algo.
 */
const ULTIMAS_EN_TIRA = 30;
/** Ventana de la fila de atención. */
const ATENCION_HORAS = 24;
/** Una matrícula denegada esta cantidad de veces en la ventana es merodeo: mismo umbral que el historial. */
const MERODEO_DENEGADOS = 4;

/** Lo que la cámara manda cuando NO leyó una chapa: no es una matrícula y no puede ser merodeo ni vigilancia. */
const NO_ES_CHAPA = new Set(["", "NOLEIDA", "NOLEIDO", "UNKNOWN", "SINLECTURA", "SINMATRICULA", "NONE", "NULL"]);
const esChapa = (ch: string | null | undefined): ch is string => !!ch && !NO_ES_CHAPA.has(ch);


/** Cuántas no registradas "en el barrio" se muestran como mucho. */
const NO_REGISTRADAS_MAX = 30;
/** Cuántos avisos pendientes entran en la fila de atención. */
const AVISOS_MAX = 30;

/**
 * GET /api/monitor/lpr → la última lectura, la tira, los contadores del día del barrio, la
 * fila de atención y lo que hay en el barrio ahora.
 *
 * El modo de acceso (Ajustes → Visitas y patrones) cambia qué se cuenta:
 *  · CERRADO: como siempre — entradas y salidas permitidas, denegados, adentro por la última
 *    lectura permitida, y merodeo por denegados repetidos.
 *  · ABIERTO: no hay barrera, así que "permitido" no significa nada. Se cuentan todas las
 *    entradas y salidas, las lecturas no registradas, las visitas en curso; el merodeo
 *    calculado (que marcaba a cualquier no registrado leído cuatro veces) se reemplaza por los
 *    avisos de patrones a la guardia.
 */
export async function GET() {
    const p = await autorizarMonitor("/api/monitor/lpr");
    if (p.error) return p.error;
    const aj = await leerAjustesVisitas();
    const abierto = aj.modo === "ABIERTO";
    const hoy = inicioDelDia();
    const desdeAtencion = new Date(Date.now() - ATENCION_HORAS * 3600 * 1000);
    const inc = INCLUIR_LECTURA;
    const soloPermitidas = abierto ? {} : { decision: "GRANT" as any };
    const [ultimas, entradas, salidas, denegados, recientes, visitas, avisos] = await Promise.all([
        prisma.accessEvent.findMany({ orderBy: { timestamp: "desc" }, take: ULTIMAS_EN_TIRA + 1, include: inc }),
        prisma.accessEvent.count({ where: { timestamp: { gte: hoy }, direction: "ENTRY", ...soloPermitidas } }),
        prisma.accessEvent.count({ where: { timestamp: { gte: hoy }, direction: "EXIT", ...soloPermitidas } }),
        abierto ? Promise.resolve(0) : prisma.accessEvent.count({ where: { timestamp: { gte: hoy }, decision: "DENY" } }),
        prisma.accessEvent.findMany({ where: { timestamp: { gte: desdeAtencion } }, orderBy: { timestamp: "desc" }, take: 500, select: { id: true, timestamp: true, plateDetected: true, decision: true, details: true, direction: true, device: { select: { name: true } } } }),
        prisma.visita.findMany({ where: { sale: null }, orderBy: { vence: "asc" }, take: 200 }).catch(() => []),
        prisma.avisoGuardia.findMany({ where: { atendidoAt: null }, orderBy: { creado: "desc" }, take: AVISOS_MAX }).catch(() => []),
    ]);

    // Registradas (padrón, visita, invitación, lista blanca) entre las que se muestran.
    const reg = await registradas(ultimas.map((e) => e.plateDetected));
    const conRegistro = (e: any) => { const f = forma(e); const ch = normalizarMatricula(f.plate); return { ...f, registrada: !!(ch && reg.has(ch)) }; };

    let adentro = 0, noRegistrados = 0;
    let enBarrio: any[] = [];
    if (abierto) {
        // Hoy: la última lectura de cada matrícula. Si fue una entrada y no está registrada, está
        // (probablemente) adentro: tiempo ESTIMADO, porque el 55 % de las entradas no se ve salir.
        const filas = await prisma.$queryRaw<{ p: string; dir: string; t: Date; primera: Date; id: string; camara: string | null }[]>`
            SELECT DISTINCT ON (p) p, dir, t, primera, id, camara FROM (
                SELECT upper(regexp_replace(e."plateDetected", '[^A-Za-z0-9]', '', 'g')) AS p, e.direction::text AS dir, e.timestamp AS t, e.id, d.name AS camara,
                       min(e.timestamp) OVER (PARTITION BY upper(regexp_replace(e."plateDetected", '[^A-Za-z0-9]', '', 'g'))) AS primera
                  FROM "AccessEvent" e LEFT JOIN "Device" d ON d.id = e."deviceId"
                 WHERE e.timestamp >= ${hoy} AND e."plateDetected" IS NOT NULL) x
             WHERE length(p) >= 5 ORDER BY p, t DESC`;
        const validas = filas.filter((f) => esChapa(f.p));
        const regHoy = await registradas(validas.map((f) => f.p));
        noRegistrados = validas.filter((f) => !regHoy.has(f.p)).length;
        const sinSalida = validas.filter((f) => f.dir === "ENTRY" && !regHoy.has(f.p)).sort((a, b) => +b.t - +a.t);
        adentro = visitas.length;
        enBarrio = sinSalida.slice(0, NO_REGISTRADAS_MAX).map((f) => ({ tipo: "NO_REGISTRADA", plate: f.p, desde: f.t.toISOString(), estimado: true, camara: f.camara, accessEventId: f.id }));
    } else {
        // Adentro ahora (cerrado): matrículas cuya última lectura permitida de hoy fue una entrada.
        const ultimaPorChapa = new Map<string, "ENTRY" | "EXIT">();
        const hoyOrdenado = recientes.filter((e) => e.timestamp >= hoy && e.decision === "GRANT").sort((a, b) => +a.timestamp - +b.timestamp);
        for (const e of hoyOrdenado) { const ch = normalizarMatricula(e.plateDetected); if (esChapa(ch)) ultimaPorChapa.set(ch, e.direction as any); }
        adentro = [...ultimaPorChapa.values()].filter((d) => d === "ENTRY").length;
    }
    const tipos = new Map(aj.tipos.map((t) => [t.clave, t.nombre]));
    const visitasEnCurso = visitas.map((v) => ({
        tipo: "VISITA", id: v.id, plate: v.plate, tipoVisita: v.tipo, tipoNombre: tipos.get(v.tipo) || v.tipo, lote: v.loteNombre, nombre: v.nombre, empresa: v.empresa,
        origen: v.origen, desde: v.entra.toISOString(), vence: v.vence.toISOString(), accessEventId: v.accessEventEntradaId,
    }));

    // Fila de atención.
    const chapas = [...new Set(recientes.map((e) => normalizarMatricula(e.plateDetected)).filter(esChapa))];
    const vigiladas = chapas.length ? await prisma.plateWatch.findMany({ where: { active: true, plate: { in: chapas }, category: { in: ["BLACKLISTED", "SEARCH"] } }, select: { plate: true, category: true, motivo: true, label: true } }).catch(() => []) : [];
    const porChapa = new Map(vigiladas.map((v) => [normalizarMatricula(v.plate), v]));
    const denegadasPorChapa = new Map<string, number>();
    for (const e of recientes) { const ch = normalizarMatricula(e.plateDetected); if (esChapa(ch) && e.decision === "DENY") denegadasPorChapa.set(ch, (denegadasPorChapa.get(ch) || 0) + 1); }
    const vistas = new Set<string>();
    const atencion: { id: string | null; plate: string | null; tipo: "LISTA_NEGRA" | "EN_BUSQUEDA" | "MERODEO" | "AVISO"; motivo: string; ts: string; camara: string | null; veces?: number; avisoId?: string; avisoTipo?: string }[] = [];
    for (const e of recientes) {
        const ch = normalizarMatricula(e.plateDetected); if (!esChapa(ch) || vistas.has(ch)) continue;
        const v = porChapa.get(ch);
        if (v) { vistas.add(ch); atencion.push({ id: e.id, plate: ch, tipo: v.category === "SEARCH" ? "EN_BUSQUEDA" : "LISTA_NEGRA", motivo: v.motivo || v.label || "sin motivo cargado", ts: e.timestamp.toISOString(), camara: e.device?.name || null }); continue; }
        if (!abierto && (denegadasPorChapa.get(ch) || 0) >= MERODEO_DENEGADOS) { vistas.add(ch); atencion.push({ id: e.id, plate: ch, tipo: "MERODEO", motivo: `${denegadasPorChapa.get(ch)} lecturas denegadas en ${ATENCION_HORAS} h`, ts: e.timestamp.toISOString(), camara: e.device?.name || null, veces: denegadasPorChapa.get(ch) }); }
    }
    // Los avisos de patrones a la guardia, arriba de todo (en los dos modos).
    atencion.unshift(...avisos.map((a) => ({ id: a.accessEventId, plate: a.plate, tipo: "AVISO" as const, motivo: a.motivo, ts: a.creado.toISOString(), camara: a.camara, avisoId: a.id, avisoTipo: a.tipo })));
    return NextResponse.json({
        modo: aj.modo,
        ultima: ultimas[0] ? conRegistro(ultimas[0]) : null,
        tira: ultimas.slice(1, ULTIMAS_EN_TIRA + 1).map(conRegistro),
        contadores: { entradas, salidas, denegados, noRegistrados, adentro, actualizado: new Date().toISOString(), dia: hoy.toISOString() },
        enBarrio: { visitas: visitasEnCurso, noRegistradas: enBarrio },
        atencion, ahora: new Date().toISOString(),
        // Matrícula → logo de su empresa (delivery, taxi), para incrustarlo en la captura.
        logos: await logosDeMatriculas().catch(() => ({})),
    }, { headers: SIN_CACHE });
}
