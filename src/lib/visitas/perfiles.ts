import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ZONA } from "@/lib/fechas";
import { leerAjustesVisitas } from "./ajustes";
import { detectarRutina, claseDe, entradaNoVista, type Llegada } from "./calculos";
import { enPadron, esChapa } from "./registro";

/**
 * Recalcula los perfiles de todas las matrículas leídas en la ventana (30 días por defecto),
 * en una sola consulta agregada y en hora del barrio. Corre desde el tick cada 10 minutos,
 * fuera del camino de las lecturas: la mediana y el desvío necesitan todas las visitas de la
 * matrícula, y eso en lote es una consulta; en cada lectura serían miles.
 *
 * Cámaras: interior cuenta como "adentro" igual que una de entrada. La frecuencia y la rutina
 * salen de la PRIMERA lectura de cada día en cualquier cámara LPR: la de Entrada casi no lee
 * de noche, y mirar sólo entradas dejaba sin rutina a quien llega o se va de noche.
 */

/** Una entrada y su salida tienen que estar a menos de esto para contar como una visita. Medido:
 *  el 90 % de las permanencias con salida leída dura menos de 7 h 11 min; 12 h deja margen sin
 *  emparejar la entrada de un día con la salida del siguiente. */
const MAX_VISITA_HORAS = 12;
/** Una matrícula de menos caracteres es una lectura rota, no una chapa. */
const LARGO_MIN_CHAPA = 5;
/** De a cuántas filas se escribe, para no armar una transacción enorme. */
const LOTE_ESCRITURA = 200;

type Fila = {
    p: string; primera: Date; ultima: Date; dias: number; entradas: number; salidas: number;
    con_salida: number; mediana: number | null; p90: number | null; llegadas: { dow: number; minuto: number }[] | null;
};

export async function recalcularPerfiles(): Promise<{ matriculas: number; escritas: number; ms: number }> {
    const t0 = Date.now();
    const aj = await leerAjustesVisitas(true);
    const filas = await prisma.$queryRawUnsafe<Fila[]>(`
        WITH ev AS (
            SELECT upper(regexp_replace(e."plateDetected", '[^A-Za-z0-9]', '', 'g')) AS p,
                   e.timestamp AS t,
                   (e.timestamp AT TIME ZONE 'UTC' AT TIME ZONE $1) AS tl,
                   CASE WHEN d."deviceType" = 'LPR_INTERIOR' THEN 'I' WHEN d.direction = 'EXIT' THEN 'S' ELSE 'E' END AS cam
              FROM "AccessEvent" e LEFT JOIN "Device" d ON d.id = e."deviceId"
             WHERE e.timestamp >= now() - ($2 || ' days')::interval AND e."plateDetected" IS NOT NULL
        ), ok AS (SELECT * FROM ev WHERE length(p) >= ${LARGO_MIN_CHAPA}),
        -- La primera salida posterior a cada lectura, con una ventana (no un subselect por fila:
        -- con 25 mil lecturas eso eran cientos de millones de comparaciones).
        sig AS (
            SELECT p, t, cam,
                   min(t) FILTER (WHERE cam = 'S') OVER (PARTITION BY p ORDER BY t ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING) AS salida
              FROM ok
        ),
        pares AS (
            SELECT p, extract(epoch FROM (salida - t)) / 60 AS dur
              FROM sig WHERE cam IN ('E', 'I') AND salida IS NOT NULL AND salida < t + interval '${MAX_VISITA_HORAS} hours'
        ),
        llegadas AS (
            SELECT p, date(tl) AS dia, extract(isodow FROM min(tl))::int AS dow,
                   (extract(hour FROM min(tl)) * 60 + extract(minute FROM min(tl)))::int AS minuto
              FROM ok GROUP BY p, date(tl)
        )
        SELECT a.p, a.primera, a.ultima, a.dias, a.entradas, a.salidas,
               coalesce(pr.n, 0)::int AS con_salida, pr.mediana, pr.p90, l.llegadas
          FROM (SELECT p, min(t) AS primera, max(t) AS ultima, count(DISTINCT date(tl))::int AS dias,
                       count(*) FILTER (WHERE cam IN ('E', 'I'))::int AS entradas,
                       count(*) FILTER (WHERE cam = 'S')::int AS salidas
                  FROM ok GROUP BY p) a
          LEFT JOIN (SELECT p, count(*) AS n,
                            percentile_cont(0.5) WITHIN GROUP (ORDER BY dur) AS mediana,
                            percentile_cont(0.9) WITHIN GROUP (ORDER BY dur) AS p90
                       FROM pares GROUP BY p) pr ON pr.p = a.p
          LEFT JOIN (SELECT p, json_agg(json_build_object('dow', dow, 'minuto', minuto)) AS llegadas FROM llegadas GROUP BY p) l ON l.p = a.p`,
        ZONA, String(aj.ventanaPerfilDias));

    const validas = filas.filter((f) => esChapa(f.p));
    const padron = await enPadron(validas.map((f) => f.p));
    // El lote más reciente en el que se registró una visita con esa matrícula.
    const lotes = await prisma.visita.findMany({ where: { plate: { in: validas.map((f) => f.p) }, unitId: { not: null } }, orderBy: { entra: "desc" }, select: { plate: true, unitId: true } }).catch(() => []);
    const lotePorChapa = new Map<string, string>();
    for (const v of lotes) if (v.plate && v.unitId && !lotePorChapa.has(v.plate)) lotePorChapa.set(v.plate, v.unitId);

    const previos = new Map((await prisma.perfilMatricula.findMany({ select: { plate: true, diasVistos: true, entradas: true, salidas: true, clase: true, ultimaVez: true, rutina: true } })).map((p) => [p.plate, p]));
    const escribir: any[] = [];
    for (const f of validas) {
        const noVista = entradaNoVista({ entradas: f.entradas, salidas: f.salidas });
        const rutina = detectarRutina((f.llegadas || []) as Llegada[], aj.rutinaDiasMin, aj.rutinaDesvioMaxMin);
        const datos = {
            primeraVez: new Date(f.primera), ultimaVez: new Date(f.ultima), diasVistos: f.dias, entradas: f.entradas, salidas: f.salidas,
            visitasConSalida: f.con_salida,
            permanenciaMedianaMin: f.mediana != null ? Math.round(Number(f.mediana)) : null,
            permanenciaP90Min: f.p90 != null ? Math.round(Number(f.p90)) : null,
            entradaNoVista: noVista, rutina: rutina ?? undefined,
            clase: claseDe({ enPadron: padron.has(f.p), rutina, diasVistos: f.dias }),
            unitIdProbable: lotePorChapa.get(f.p) || null,
            actualizado: new Date(),
        };
        const prev = previos.get(f.p);
        const igual = prev && prev.diasVistos === datos.diasVistos && prev.entradas === datos.entradas && prev.salidas === datos.salidas
            && prev.clase === datos.clase && +prev.ultimaVez === +datos.ultimaVez && JSON.stringify(prev.rutina ?? null) === JSON.stringify(rutina ?? null);
        if (!igual) escribir.push({ plate: f.p, datos, rutinaNula: !rutina });
    }
    for (let i = 0; i < escribir.length; i += LOTE_ESCRITURA) {
        await prisma.$transaction(escribir.slice(i, i + LOTE_ESCRITURA).map((e) => prisma.perfilMatricula.upsert({
            where: { plate: e.plate },
            create: { plate: e.plate, ...e.datos },
            // Prisma no borra un Json con `undefined`: una rutina que dejó de serlo se pone en DbNull.
            update: { ...e.datos, ...(e.rutinaNula ? { rutina: Prisma.DbNull } : {}) },
        }) as any));
    }
    return { matriculas: validas.length, escritas: escribir.length, ms: Date.now() - t0 };
}
