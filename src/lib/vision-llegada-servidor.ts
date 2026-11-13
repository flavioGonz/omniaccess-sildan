import { prisma } from "@/lib/prisma";
import { buscadorDeLlegada, papelDe, MARGEN_MS, type Llegada, type PistaLugar } from "@/lib/vision-llegada";

/*
 * La búsqueda de la llegada contra el registro de detecciones (ObjetoVisto). Las reglas están en
 * lib/vision-llegada; acá sólo se traen las pistas, de a tandas y hacia atrás.
 *
 * Se le pide a la base SÓLO lo que toca el lugar (una pista que empieza o termina cerca de su
 * punto de apoyo): una cámara de calle registra miles de vehículos por día y un auto puede llevar
 * días estacionado; traer todo para filtrarlo acá serían decenas de megas por un clic.
 */

/** Hasta dónde hacia atrás se busca: lo que guarda el registro. */
const ATRAS_MAX_MS = 7 * 86_400_000;
/** Pistas por tanda. */
const TANDA = 300;
/** Tope de tandas: un auto que lleva días quieto en una escena quieta son ~1.400 pistas por día. */
const TANDAS_MAX = 40;

type Fila = { primeraVez: Date; ultimaVez: Date; caja: unknown; recorrido: unknown; vector: Uint8Array | null };
/** Las huellas se guardan en int8: el coseno entre dos dice cuánto se parecen los dos recortes. */
const aInt8 = (v: Uint8Array) => new Int8Array(v.buffer, v.byteOffset, v.length);
function coseno(a: Int8Array, b: Int8Array): number {
    let d = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length && i < b.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return d / (Math.sqrt(na * nb) || 1);
}
/** Cuántas pistas recientes se miran para encontrar la huella del vehículo que está ahora. */
const REFERENCIA_PISTAS = 60;

export async function buscarLlegadaEnRegistro(deviceId: string, lugar: number[], op: { ahora?: number; reloj?: number | null; huecoMs?: number } = {}): Promise<Llegada & { pistas: number; tandas: number }> {
    const ahora = op.ahora ?? Date.now(), tope = ahora - ATRAS_MAX_MS;
    const w = lugar[2] - lugar[0], h = lugar[3] - lugar[1], cx = (lugar[0] + lugar[2]) / 2;
    // El entorno del punto de apoyo del lugar, con la holgura más ancha que usan las reglas (1,6) y un poco más.
    const x1 = cx - w * 0.55, x2 = cx + w * 0.55, y1 = lugar[3] - h * 0.42, y2 = lugar[3] + h * 0.42;
    const huboOtraCosa = async (a: number, b: number) => {
        // Con un minuto de margen a cada lado: la pista que cierra el hueco no cuenta como «otra cosa».
        if (b - a <= 120_000) return false;
        return (await prisma.objetoVisto.count({ where: { deviceId, ultimaVez: { gt: new Date(a + 60_000), lt: new Date(b - 60_000) } } })) > 0;
    };
    const reloj = op.reloj != null && op.reloj <= ahora ? op.reloj : null;
    /*
     * La huella del vehículo que está AHORA: la de su pista quieta más reciente en el lugar. Contra
     * ella se compara cada pista de antes, para no seguir de largo hasta otro auto que estuvo en
     * ese mismo lugar. Sin referencia (el registro todavía no lo tiene, o esa cámara no guarda
     * huellas) no se mira hacia atrás: se contesta la hora del reloj.
     */
    const recientes = await prisma.$queryRaw<Fila[]>`
        SELECT o."primeraVez", o."ultimaVez", o."caja", o."recorrido", h."vector" FROM "ObjetoVisto" o JOIN "HuellaObjeto" h ON h."objetoId" = o."id"
        WHERE o."deviceId" = ${deviceId} AND o."grupo" = 'vehiculo' AND o."ultimaVez" >= ${new Date((reloj ?? ahora) - 60_000).toISOString()}::timestamp
          AND jsonb_typeof(o."recorrido") = 'array' AND jsonb_array_length(o."recorrido") > 0
          AND (o."recorrido"->-1->>0)::float BETWEEN ${x1} AND ${x2} AND (o."recorrido"->-1->>1)::float BETWEEN ${y1} AND ${y2}
        ORDER BY o."ultimaVez" DESC LIMIT ${REFERENCIA_PISTAS}`;
    const ref = recientes.find((f) => f.vector && papelDe({ desde: 0, hasta: 0, recorrido: f.recorrido as number[][] }, lugar) === "quieta");
    if (!ref?.vector) return { ms: reloj ?? ahora, como: "reloj", corte: "fin", pistas: recientes.length, tandas: 0 };
    const huella = aInt8(ref.vector);
    const buscador = buscadorDeLlegada(lugar, { ahora, reloj, huecoMs: op.huecoMs, huboOtraCosa });
    /*
     * Las fechas van como texto ISO convertido a `timestamp`, no como Date: la columna guarda la
     * hora en UTC sin zona, y un Date llega como «con zona» y la base lo pasa a su hora local antes
     * de comparar. Medido el 13/11 en el lab (UTC−3): con Date, la consulta dejaba afuera las
     * últimas tres horas de pistas y la búsqueda no encontraba al vehículo que estaba ahí.
     */
    let antesDe = new Date(ahora + 60_000), pistas = 0, tandas = 0;
    // Lo que empezó después de la hora del reloj no dice nada de cómo llegó (la pista de entrada empezó antes).
    const empezoAntesDe = new Date((reloj ?? ahora) + MARGEN_MS + 60_000);
    while (tandas < TANDAS_MAX) {
        const filas = await prisma.$queryRaw<Fila[]>`
            SELECT o."primeraVez", o."ultimaVez", o."caja", o."recorrido", h."vector" FROM "ObjetoVisto" o LEFT JOIN "HuellaObjeto" h ON h."objetoId" = o."id"
            WHERE o."deviceId" = ${deviceId} AND o."grupo" = 'vehiculo' AND o."ultimaVez" < ${antesDe.toISOString()}::timestamp AND o."ultimaVez" >= ${new Date(tope).toISOString()}::timestamp
              AND o."primeraVez" < ${empezoAntesDe.toISOString()}::timestamp
              AND jsonb_typeof(o."recorrido") = 'array' AND jsonb_array_length(o."recorrido") > 0
              AND ( ((o."recorrido"->-1->>0)::float BETWEEN ${x1} AND ${x2} AND (o."recorrido"->-1->>1)::float BETWEEN ${y1} AND ${y2})
                 OR ((o."recorrido"->0->>0)::float BETWEEN ${x1} AND ${x2} AND (o."recorrido"->0->>1)::float BETWEEN ${y1} AND ${y2}) )
            ORDER BY o."ultimaVez" DESC LIMIT ${TANDA}`;
        tandas++;
        if (!filas.length) break;
        pistas += filas.length;
        const lote: PistaLugar[] = filas.map((f) => ({ desde: f.primeraVez.getTime(), hasta: f.ultimaVez.getTime(), caja: Array.isArray(f.caja) ? (f.caja as number[]) : null, recorrido: f.recorrido as number[][], parecido: f.vector ? coseno(huella, aInt8(f.vector)) : null }));
        const r = await buscador.sumar(lote);
        if (r) return { ...r, pistas, tandas };
        if (filas.length < TANDA) break;
        antesDe = filas[filas.length - 1].ultimaVez;
    }
    return { ...buscador.cerrar(tope), pistas, tandas };
}
