import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
    cerrarEstadia, confirmarEstadia, estadoDeEstadia, miradasSinVerlo,
    ESTADIA_VENCE_MIN, ESTADIA_TECHO_MIN, MIRADAS_MIN, ESTADOS_DE_ESTADIA,
} from "@/lib/estadias";
import { mirarSiSigue, VIGILIA_POR_VUELTA } from "@/lib/vigilia";
import { funcionActiva } from "@/app/actions/funciones";

export const dynamic = "force-dynamic";

/**
 * POST /api/tracking/stays/sweep
 *
 * Cierra las estadías vencidas y avisa que esos vehículos se fueron.
 *
 * Hace falta un barrido porque un auto que se va no genera ninguna lectura. Todo lo demás
 * del seguimiento nace de algo que la cámara vio; esto nace de algo que dejó de ver.
 *
 * Y ahí está lo delicado: **la ausencia solo es evidencia si uno estaba mirando.** La
 * primera versión cerraba por reloj a los doce minutos, y eso partió al mismo auto
 * estacionado toda la noche en cuatro estadías encadenadas, cada una con su "se retiró" y
 * su "estacionó" — porque un auto quieto solo se relee cuando otro vehículo dispara una
 * ráfaga, y de madrugada eso pasa cada veinte o veinticinco minutos.
 *
 * Ahora se cierra cuando pasó el tiempo Y la cámara miró sin verlo: al menos MIRADAS_MIN
 * ráfagas con otras matrículas después de la última vez que se lo vio. Si la cámara no
 * miró — se cayó, o no pasó nadie — la estadía queda abierta hasta el techo, porque el
 * auto probablemente siga ahí y decir que se fue sería inventar.
 *
 * **Y antes de cerrar, va a mirar.** Esperar a que otro vehículo dispare una ráfaga anda en
 * una calle con tránsito y no anda en una tranquila: una de las cámaras de acá tuvo UNA
 * lectura en dos horas, y en ese hueco un auto estacionado enfrente desaparecía del plano.
 * La vigilia mira el pedazo de calle donde estaba el auto y compara píxeles con la vez
 * anterior — sin GPU. Recién si eso cambió le pide la chapa al lector, y sobre el recorte,
 * no sobre el cuadro entero. Ver `src/lib/vigilia.ts`.
 *
 * Quiénes se miran sale solo: candidata es la estadía que hace ESTADIA_VENCE_MIN que nadie
 * lee. Un auto que se está releyendo cada minuto nunca entra acá, así que no se le gasta una
 * sola mirada; y una que sigue viva vuelve a quedar fuera por otros doce minutos. El ritmo
 * lo pone la propia falta de lecturas, que es exactamente lo que se quiere vigilar.
 *
 * Lo llama la pasarela una vez por minuto. Es idempotente: cerrar una estadía ya cerrada
 * no hace nada ni vuelve a avisar.
 */
export async function POST(req: NextRequest) {
    const token = req.headers.get("x-tracking-token") || "";
    let esperado = process.env.TRACKING_TOKEN || "";
    if (!esperado) {
        const s = await prisma.setting.findUnique({ where: { key: "TRACKING_TOKEN" } });
        esperado = s?.value || "";
    }
    if (!esperado || token !== esperado) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    /* Apagadas las estadías no hay nada que barrer. No se cierran las que quedaron
       abiertas: apagar una función no es borrar lo que registró, y al volver a prenderla
       esas estadías siguen siendo ciertas o las cierra el techo. */
    if (!(await funcionActiva("LPR_ESTADIAS"))) {
        return NextResponse.json({ ok: true, apagado: true, revisadas: 0, avisadas: 0, esperando: 0, cerradas: [] });
    }

    const ahora = Date.now();
    const corte = new Date(ahora - ESTADIA_VENCE_MIN * 60 * 1000);
    const techo = new Date(ahora - ESTADIA_TECHO_MIN * 60 * 1000);

    const candidatas = await prisma.plateSighting.findMany({
        where: {
            source: "TRACK",
            // Tambien las que quedaron en VISTO: son filas abiertas igual, y si nunca
            // llegaron a ser un estacionamiento se cierran en silencio, sin avisar nada.
            estado: { in: ESTADOS_DE_ESTADIA },
            estCerrada: false,
            estHasta: { lt: corte },
        },
        orderBy: { estHasta: "asc" },
        take: 200,
    });
    if (!candidatas.length) {
        return NextResponse.json({ ok: true, revisadas: 0, avisadas: 0, esperando: 0, cerradas: [] });
    }

    // Las lecturas de cada cámara se traen UNA vez, no una por estadía: en una cámara con
    // varias estadías abiertas son las mismas lecturas para todas.
    const masVieja = candidatas.reduce(
        (m, f) => Math.min(m, f.estHasta?.getTime() ?? ahora), ahora,
    );
    const camaras = [...new Set(candidatas.map((f) => f.deviceId).filter(Boolean))] as string[];
    const porCamara = new Map<string, { plate: string; timestamp: Date }[]>();
    await Promise.all(camaras.map(async (deviceId) => {
        const filas = await prisma.plateSighting.findMany({
            where: { deviceId, source: "TRACK", timestamp: { gt: new Date(masVieja) } },
            orderBy: { timestamp: "desc" },
            take: 400,
            select: { plate: true, timestamp: true },
        });
        porCamara.set(deviceId, filas);
    }));

    /* Las cámaras de las candidatas, una sola vez: la vigilia necesita el RTSP y la zona de
       interés, y varias estadías pueden ser de la misma cámara. */
    const equipos = new Map<string, { rtspUrl: string | null; trackRoi: string | null }>();
    if (camaras.length) {
        const filas = await prisma.device.findMany({
            where: { id: { in: camaras } },
            select: { id: true, rtspUrl: true, trackRoi: true },
        });
        for (const d of filas) equipos.set(d.id, { rtspUrl: d.rtspUrl, trackRoi: d.trackRoi });
    }

    const cerradas: { plate: string; camara: string | null; minutos: number; motivo: string }[] = [];
    const miradasHechas: { plate: string; camara: string | null; resultado: string; gpu: boolean; detalle: string }[] = [];
    let esperando = 0;
    let quedanMiradas = VIGILIA_POR_VUELTA;

    for (const fila of candidatas) {
        const lecturas = fila.deviceId ? porCamara.get(fila.deviceId) || [] : [];
        const miradas = miradasSinVerlo(fila as any, lecturas);
        const porTecho = (fila.estHasta?.getTime() ?? ahora) < techo.getTime();

        /*
         * Primero se va a mirar, y lo que se vea manda sobre todo lo demás.
         *
         * Sólo para las estadías CONFIRMADAS: una que nunca llegó a ser un estacionamiento
         * se cierra en silencio sin avisar nada, y no vale una mirada. Las candidatas vienen
         * ordenadas de la más vieja a la más nueva, así que si el cupo de la vuelta no
         * alcanza, se gasta en las que hace más tiempo que nadie mira.
         */
        /*
         * También las que NO están confirmadas todavía, y eso es el arreglo de un callejón
         * sin salida.
         *
         * Una estadía nace en VISTO y sólo pasa a ESTACIONADO cuando se la ve dos veces
         * separadas en el tiempo. En una calle con tránsito eso ocurre solo. En una
         * tranquila no: la cámara de la Calle 21 lee el auto parado una vez cada varias
         * horas, así que cada lectura abría una estadía nueva con estDesde igual a estHasta
         * — duración cero — que vencia antes de la segunda. Cuatro estadías cerradas en un
         * día por un auto que no se movió nunca, y el plano sin un solo auto parado.
         *
         * La vigilia miraba sólo las confirmadas, así que no rompía el círculo: para que la
         * miraran tenía que estar confirmada, y para confirmarse tenía que ser mirada.
         *
         * Y mirar es justamente lo que falta. Ver el mismo auto en el mismo lugar dos veces
         * separadas por doce minutos ES la prueba que el estado pide; que la segunda sea una
         * mirada de píxeles y no una lectura de la chapa no la hace peor — de hecho de
         * noche la hace mejor.
         */
        const equipo = fila.deviceId ? equipos.get(fila.deviceId) : null;
        if (equipo?.rtspUrl && quedanMiradas > 0) {
            quedanMiradas--;
            const vista = await mirarSiSigue(
                { id: fila.id, plate: fila.plate, bbox: fila.bbox },
                equipo,
            ).catch((e) => ({ resultado: "no se pudo" as const, gpu: false, detalle: String(e?.message || e), fallas: 0 }));

            miradasHechas.push({
                plate: fila.plate, camara: fila.cameraName,
                resultado: vista.resultado, gpu: vista.gpu, detalle: vista.detalle,
            });

            if (vista.resultado === "sigue") {
                /* Sigue ahí: la estadía se estira hasta ahora. No se crea una lectura nueva
                   —esto es una mirada, no un avistamiento de la cámara— y por eso tampoco se
                   toca `timestamp`, que sigue queriendo decir "la última vez que se le leyó
                   la chapa". */
                const ahoraMismo = new Date();
                const estirada = await prisma.plateSighting.update({
                    where: { id: fila.id },
                    data: {
                        estHasta: ahoraMismo,
                        /* Y el estado se recalcula: con la estadía estirada puede haber
                           dejado de ser "se lo vio" para pasar a ser "se quedó". */
                        estado: estadoDeEstadia(fila.estDesde ?? fila.timestamp, ahoraMismo),
                    },
                }).catch(() => null);
                /* Y si con esto ya alcanza, se anuncia. `confirmarEstadia` no hace nada si
                   ya estaba avisada o si todavía no llegó al mínimo, así que llamarla en cada
                   vuelta es gratis y evita tener que repetir sus reglas acá. */
                if (estirada) await confirmarEstadia(estirada as any).catch(() => { });
                continue;
            }
            if (vista.resultado === "no se pudo") {
                /* No se sabe. No se cierra por no saber: se deja para la vuelta que viene, y
                   si la cámara nunca vuelve, el techo es el que corta. */
                esperando++;
                continue;
            }
            /* "se fue": mirado y no encontrado. Eso cierra, sin pedirle permiso a las reglas
               de abajo — que existen justamente porque antes no se podía ir a mirar. */
            const aviso = await cerrarEstadia(fila as any).catch(() => false);
            if (aviso) cerradas.push({
                plate: fila.plate, camara: fila.cameraName,
                minutos: Math.round(((fila.estHasta?.getTime() ?? 0) - (fila.estDesde?.getTime() ?? 0)) / 60000),
                motivo: `se fue mirándolo: ${vista.detalle}`,
            });
            continue;
        }

        if (miradas < MIRADAS_MIN && !porTecho) {
            // La cámara no volvió a mirar. No hay nada que probar una ausencia.
            esperando++;
            continue;
        }

        const aviso = await cerrarEstadia(fila as any).catch(() => false);
        if (aviso) {
            cerradas.push({
                plate: fila.plate,
                camara: fila.cameraName,
                minutos: Math.round(
                    ((fila.estHasta?.getTime() ?? 0) - (fila.estDesde?.getTime() ?? 0)) / 60000,
                ),
                motivo: porTecho && miradas < MIRADAS_MIN ? "techo" : `${miradas} miradas sin verlo`,
            });
        }
    }

    return NextResponse.json({
        ok: true,
        revisadas: candidatas.length,
        miradas: miradasHechas,
        avisadas: cerradas.length,
        // Las que vencieron por reloj pero todavía no tienen prueba de ausencia.
        esperando,
        cerradas,
    });
}
