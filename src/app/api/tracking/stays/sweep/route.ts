import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
    cerrarEstadia, confirmarEstadia, miradasSinVerlo, ESTACIONADO,
    ESTADIA_VENCE_MIN, ESTADIA_TECHO_MIN, MIRADAS_MIN, ESTADOS_DE_ESTADIA,
} from "@/lib/estadias";
import { mirarSiSigue, VIGILIA_POR_VUELTA } from "@/lib/vigilia";
import { funcionActiva } from "@/app/actions/funciones";
import { mirarLaFranja } from "@/lib/ocupaciones";

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
        return NextResponse.json({ ok: true, apagado: true, franjas: [], revisadas: 0, avisadas: 0, esperando: 0, cerradas: [] });
    }

    /*
     * Primero la franja, que es el criterio bueno.
     *
     * Las cámaras que tienen franja dibujada miden OCUPACIÓN DEL LUGAR: el polígono no se
     * mueve, su aspecto vacío se conoce, y un auto encima tapa la celda entera. Eso
     * contesta la pregunta que el criterio de abajo no puede contestar — "¿sigue ahí?" —
     * porque abajo la única prueba disponible es otra lectura de la misma chapa, y una
     * lectura no dice nada sobre si el vehículo está quieto.
     *
     * Y por eso esas cámaras quedan EXCLUIDAS del barrido viejo: dos motores sobre la misma
     * calle darían dos estadías por auto, y la peor de las dos seguiría mandando avisos.
     * El criterio viejo sobrevive sólo donde todavía no hay franja dibujada.
     */
    /*
     * `vacio: { not: null }` — y esto NO es un detalle.
     *
     * Abajo, las cámaras de esta lista quedan EXCLUIDAS del barrido por chapa, porque se
     * asume que su franja se hace cargo. Pero una franja dibujada y sin el vacío aprendido
     * no mide nada: `mirarLaFranja` no tiene contra qué comparar.
     *
     * Con el filtro anterior (`activa: true` a secas) esas cámaras caían en un hueco entre
     * los dos criterios: el viejo se inhibía porque "hay franja", y el nuevo no podía
     * correr porque le falta el vacío. **Nadie cerraba sus estadías.**
     *
     * Y pasó de verdad: Calle 22 tenía la franja dibujada con tres lugares y sin aprender
     * el vacío, y SBW3369 quedó marcada como estacionada CUARENTA HORAS después de su
     * última lectura, dibujada en el mapa todo ese tiempo. Calle 21, que sí aprendió el
     * vacío, cerró sus veintiocho ocupaciones sin dejar ninguna abierta.
     *
     * La regla correcta es: una franja releva al barrendero sólo si PUEDE medir.
     */
    const conFranja = await prisma.franja.findMany({
        where: { activa: true, vacio: { not: null } },
        select: { deviceId: true, device: { select: { id: true, name: true, rtspUrl: true } } },
    });
    const franjas = [];
    for (const f of conFranja) {
        franjas.push(await mirarLaFranja(f.device).catch((e: any) => ({
            deviceId: f.deviceId, medida: false, motivo: e?.message || "falló la mirada",
        })));
    }
    const camarasDeFranja = conFranja.map((f) => f.deviceId);

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
            ...(camarasDeFranja.length ? { deviceId: { notIn: camarasDeFranja } } : {}),
            /*
             * Dos caminos para ser candidata, y el segundo es el que faltaba.
             *
             * El primero es el de siempre: hace rato que no se la ve (`estHasta` viejo).
             *
             * El segundo mira `timestamp`, que es la última vez que se le LEYÓ LA CHAPA.
             * Hace falta porque la mirada de la vigilia mueve `estHasta` a "ahora" cada vez
             * que dice "no cambió nada" — y este mismo archivo explica, unas líneas más
             * abajo, que un pedazo de calle vacía también se ve igual de una mirada a la
             * otra. O sea que una estadía sostenida por miradas nunca vuelve a ser
             * candidata, y el techo de las 12 horas no se alcanza jamás: la vigilia lo
             * empuja hacia adelante sola.
             *
             * Medido: SBW3369 en Calle 22 con la última lectura del 21/09 12:53 y `estHasta`
             * moviéndose al minuto actual, cuarenta y seis horas después, dibujada en el
             * mapa todo ese tiempo.
             */
            OR: [
                { estHasta: { lt: corte } },
                { timestamp: { lt: techo } },
            ],
        },
        orderBy: { estHasta: "asc" },
        take: 200,
    });
    if (!candidatas.length) {
        return NextResponse.json({ ok: true, franjas, revisadas: 0, avisadas: 0, esperando: 0, cerradas: [] });
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
        /*
         * El techo se mide contra `timestamp` —la última lectura de chapa— y NO contra
         * `estHasta`, que la mirada de la vigilia empuja al minuto actual.
         *
         * Un techo que se mide contra un valor que la propia vigilia renueva no es un techo:
         * es una promesa que nunca vence. La lectura, en cambio, sólo la mueve la cámara
         * viendo de verdad la chapa, que es el único hecho que sostiene una afirmación
         * sobre el mundo ("ese vehículo sigue ahí").
         */
        const ultimaLectura = fila.timestamp?.getTime() ?? fila.estHasta?.getTime() ?? ahora;
        const porTecho = ultimaLectura < techo.getTime();

        /*
         * Primero se va a mirar, y lo que se vea manda sobre todo lo demás.
         *
         * Sólo para las estadías CONFIRMADAS: una que nunca llegó a ser un estacionamiento
         * se cierra en silencio sin avisar nada, y no vale una mirada. Las candidatas vienen
         * ordenadas de la más vieja a la más nueva, así que si el cupo de la vuelta no
         * alcanza, se gasta en las que hace más tiempo que nadie mira.
         */
        /*
         * También las que NO están confirmadas todavía — pero la mirada SOSTIENE la estadía
         * y ya no la asciende. Eso último fue un error, y vale dejar escrito cuál.
         *
         * El razonamiento era: ver el mismo auto en el mismo lugar dos veces separadas por
         * doce minutos es la prueba que el estado pide, y que la segunda sea una mirada de
         * píxeles en vez de una lectura de chapa no la hace peor.
         *
         * Lo que falla es la premisa. La mirada no ve *el auto*: compara el pedazo de calle
         * alrededor del último recuadro contra cómo se veía antes. **Un pedazo de calle
         * vacía también se ve igual de una mirada a la otra**, así que "no cambió nada"
         * salía como "el auto sigue" — y una lectura suelta de un auto que pasaba por una
         * parte del cuadro que esa cámara no vigila terminaba ascendida a ESTACIONADO y
         * dibujada en el mapa. Es el falso positivo que el operador vio: autos marcados
         * donde no había ninguno.
         *
         * La mirada se queda con lo que sí puede probar — que algo cambió, y por lo tanto
         * que el auto se fue — y pierde lo que no podía: crear un estacionamiento. Para
         * ascender hace falta una segunda lectura de verdad.
         *
         * El callejón sin salida que esto reabre (una calle tan tranquila que el auto
         * parado no se relee nunca) es el que resuelve la franja: ahí la pregunta pasa a ser
         * del lugar y no de la chapa, y se contesta sin depender de que alguien pase. Ver
         * `src/lib/franja.ts`.
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

            /*
             * El techo manda sobre la mirada, y tiene que mandar.
             *
             * La rama de abajo estira la estadía y hace `continue` sin mirar el techo, así
             * que una mirada que dice "sigue" la sostiene para siempre. Y este archivo ya
             * dice, más arriba, que esa prueba no prueba nada: un pedazo de calle vacía
             * también se ve igual de una mirada a la otra.
             *
             * Un techo existe justamente para ser el corte cuando la otra evidencia no es
             * confiable. Si hace más de ESTADIA_TECHO_MIN que nadie le lee la chapa, se
             * cierra — la mirada diga lo que diga.
             */
            if (vista.resultado === "sigue" && porTecho) {
                const aviso = await cerrarEstadia(fila as any).catch(() => false);
                if (aviso) cerradas.push({
                    plate: fila.plate, camara: fila.cameraName,
                    minutos: Math.round(((fila.estHasta?.getTime() ?? 0) - (fila.estDesde?.getTime() ?? 0)) / 60000),
                    motivo: `techo: hace más de ${Math.round(ESTADIA_TECHO_MIN / 60)} h que no se le lee la chapa`,
                });
                continue;
            }

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
                        /* NO se recalcula el estado: ver el comentario largo de arriba. Una
                           estadía sube a ESTACIONADO por una segunda lectura, nunca por una
                           mirada de píxeles. */
                    },
                }).catch(() => null);
                /* Sólo se anuncia la que YA era un estacionamiento por lecturas propias.
                   `confirmarEstadia` no hace nada si ya estaba avisada, así que llamarla en
                   cada vuelta es gratis. */
                if (estirada && estirada.estado === ESTACIONADO) {
                    await confirmarEstadia(estirada as any).catch(() => { });
                }
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
        franjas,
        revisadas: candidatas.length,
        miradas: miradasHechas,
        avisadas: cerradas.length,
        // Las que vencieron por reloj pero todavía no tienen prueba de ausencia.
        esperando,
        cerradas,
    });
}
