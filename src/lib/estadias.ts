import { prisma } from "@/lib/prisma";
import { notificarEvento } from "@/lib/reglas-notificacion";
import { mismaChapa } from "@/lib/matriculas";

/**
 * Estadías: cuándo un vehículo estaciona y cuándo se va.
 *
 * Una cámara de calle ve tres clases de vehículo a la vez: el que pasa, el que está
 * estacionado y el que justo está saliendo. Las tres interesan, pero por motivos
 * distintos, y hasta ahora se trataban igual — cada relectura del auto quieto entraba
 * como si hubiera pasado de nuevo.
 *
 * Una estadía es UNA fila que se va extendiendo mientras el auto siga ahí. De esa fila
 * salen los dos avisos:
 *
 *   ESTACIONÓ  cuando la estadía se consolida. No en la primera lectura quieta: un auto
 *              parado en la esquina, esperando para doblar, también se lee quieto. Se
 *              espera a que lleve un rato ahí.
 *
 *   SE FUE     cuando deja de vérselo. Este es el que no puede salir de una lectura,
 *              porque un auto que se va no genera ninguna: se nota por ausencia, y lo
 *              cierra el barrendero. La excepción es el auto que arranca delante de la
 *              cámara y vuelve a leerse en otro lugar del cuadro: ese cierra en el acto.
 */

/**
 * Los tres estados de una lectura de seguimiento.
 *
 *   PASO         cruzó por donde a esa cámara le interesa. Va al recorrido del mapa y
 *                cuenta para la efectividad.
 *   VISTO        se lo vio, pero ni cruzó por ahí ni se quedó todavía. Es la estadía en
 *                veremos: puede crecer hasta ESTACIONADO o morir sin haber sido nada.
 *   ESTACIONADO  se quedó, en el mismo lugar del cuadro, más que ESTADIA_MINIMA_SEG.
 */
export const PASO = "PASO";
export const VISTO = "VISTO";
export const ESTACIONADO = "ESTACIONADO";

/** Los dos estados que ocupa una fila de estadía, esté abierta o cerrada. */
export const ESTADOS_DE_ESTADIA = [ESTACIONADO, VISTO];

/**
 * Cuánto tiene que durar una permanencia para llamarse estacionamiento.
 *
 * Esto salió del historial antes que del código: de treinta estadías, DIECISÉIS duraban
 * cero segundos y dos más no llegaban al minuto. No eran autos estacionados. Eran autos
 * leídos una sola vez en un rincón del cuadro que esa cámara no vigila — el que pasa por
 * la vereda de enfrente — y la fila nacía con la etiqueta ESTACIONADO puesta.
 *
 * El error no era el umbral: era el momento. El estado se escribía en la primera lectura,
 * cuando todavía no había nada que lo sostuviera, y después nadie se lo sacaba. Ver un
 * auto una vez no dice que esté quieto; dice que estaba ahí en ese instante. Para
 * afirmar que está estacionado hay que verlo dos veces en el mismo lugar y que entre las
 * dos haya pasado tiempo.
 *
 * Un minuto es el piso de lo que no puede explicarse de otra manera: menos que eso lo
 * cubre una ráfaga larga, un semáforo o el auto que frena para que cruce alguien.
 */
export const ESTADIA_MINIMA_SEG = Number(process.env.TRACKING_PARKED_MIN_SEC || 60);

/** Cuánto tiene que llevar quieto para que sea "estacionó" y no "paró un momento". */
export const ESTADIA_MIN_MIN = Number(process.env.TRACKING_PARKED_CONFIRM_MIN || 3);

/**
 * Sin verlo por más que esto, la estadía PUEDE cerrarse. No alcanza con el reloj: ver
 * `miradasSinVerlo`.
 */
export const ESTADIA_VENCE_MIN = Number(process.env.TRACKING_PARKED_EXPIRE_MIN || 12);

/**
 * Cuántas veces tiene que haber mirado la cámara, sin verlo, para darlo por ido.
 *
 * Esta es la corrección de un error que se vio en el historial antes que en el código: el
 * mismo Peugeot, estacionado toda la noche frente a la Calle 22, figuraba como CUATRO
 * estadías encadenadas — 3 h 18 min, 50 min, 4 min, 38 min — con su "se retiró" y su
 * "estacionó" entre medio. El auto nunca se movió.
 *
 * La causa: un auto quieto solo se relee cuando OTRO vehículo dispara una ráfaga. De
 * madrugada en esa calle eso pasa cada veinte o veinticinco minutos, y el vencimiento
 * eran doce. La estadía vencía antes de la siguiente ráfaga, se cerraba, y la ráfaga
 * siguiente abría una nueva.
 *
 * El error de fondo es de razonamiento, no de número: **la ausencia solo es evidencia si
 * uno estaba mirando.** Que hayan pasado doce minutos no dice nada si en esos doce
 * minutos la cámara no leyó nada; dice mucho si leyó tres autos y ninguno era este. Subir
 * el vencimiento a treinta lo hubiera disimulado hasta la próxima calle tranquila.
 *
 * Entonces se cierra cuando pasó el tiempo Y la cámara miró al menos esto sin verlo. Una
 * "mirada" es una lectura de otra matrícula en esa cámara después de la última vez que se
 * vio a esta: prueba que hubo ráfaga y que el auto ya no estaba.
 */
export const MIRADAS_MIN = Number(process.env.TRACKING_PARKED_LOOKS || 2);

/**
 * Techo: sin verlo por más que esto, se cierra aunque la cámara no haya mirado nunca.
 *
 * Sin esto, una cámara que se cae o una calle sin tránsito dejarían estadías abiertas para
 * siempre, y el panel mostraría estacionado un auto que se fue hace dos días.
 */
export const ESTADIA_TECHO_MIN = Number(process.env.TRACKING_PARKED_CEILING_MIN || 720);

export const duracionMin = (desde: Date | null, hasta: Date | null) =>
    desde && hasta ? Math.max(0, (hasta.getTime() - desde.getTime()) / 60000) : 0;

export const duracionSeg = (desde: Date | null, hasta: Date | null) =>
    desde && hasta ? Math.max(0, (hasta.getTime() - desde.getTime()) / 1000) : 0;

/**
 * Qué estado le corresponde a una estadía por lo único que puede probarlo: cuánto duró.
 *
 * Es la única puerta por la que se escribe ESTACIONADO. Mientras la permanencia no llegue
 * al mínimo la fila queda en VISTO, y si nunca llega se cierra así: se la vio, no se quedó,
 * y eso es todo lo que el sistema puede afirmar de ella.
 */
export const estadoDeEstadia = (desde: Date | null, hasta: Date | null) =>
    duracionSeg(desde, hasta) >= ESTADIA_MINIMA_SEG ? ESTACIONADO : VISTO;

/**
 * Marca una estadía como consolidada y avisa, una sola vez.
 * Devuelve true si este llamado fue el que disparó el aviso.
 */
export async function confirmarEstadia(fila: {
    id: string; plate: string; deviceId: string | null; cameraName: string | null;
    estDesde: Date | null; estHasta: Date | null; estAvisado: boolean; snapshotUrl: string | null;
}) {
    if (fila.estAvisado) return false;
    if (duracionMin(fila.estDesde, fila.estHasta) < ESTADIA_MIN_MIN) return false;

    // El flag se escribe ANTES de avisar y solo si todavía estaba en false. Dos ráfagas
    // de dos cámaras pueden entrar a la vez; así el aviso sale una sola vez.
    const tomado = await prisma.plateSighting.updateMany({
        where: { id: fila.id, estAvisado: false },
        data: { estAvisado: true },
    });
    if (tomado.count === 0) return false;

    await notificarEvento({
        modulo: "LPR",
        evento: "PARKED",
        deviceId: fila.deviceId,
        deviceName: fila.cameraName,
        plate: fila.plate,
        snapshotPath: fila.snapshotUrl,
        extra: { desde: fila.estDesde, minutos: Math.round(duracionMin(fila.estDesde, fila.estHasta)) },
    }).catch(() => { });

    return true;
}

/**
 * Cierra una estadía y avisa que el vehículo se fue.
 * Solo avisa si antes se había avisado que estacionó: si nunca llegó a ser un
 * estacionamiento, tampoco hay de qué retirarse.
 */
export async function cerrarEstadia(fila: {
    id: string; plate: string; deviceId: string | null; cameraName: string | null;
    estDesde: Date | null; estHasta: Date | null; estAvisado: boolean; snapshotUrl: string | null;
}) {
    const tomado = await prisma.plateSighting.updateMany({
        where: { id: fila.id, estCerrada: false },
        data: { estCerrada: true },
    });
    if (tomado.count === 0) return false;
    if (!fila.estAvisado) return false;

    await notificarEvento({
        modulo: "LPR",
        evento: "LEFT",
        deviceId: fila.deviceId,
        deviceName: fila.cameraName,
        plate: fila.plate,
        snapshotPath: fila.snapshotUrl,
        extra: {
            desde: fila.estDesde,
            hasta: fila.estHasta,
            minutos: Math.round(duracionMin(fila.estDesde, fila.estHasta)),
        },
    }).catch(() => { });

    return true;
}

/**
 * ¿Miró la cámara y no lo vio?
 *
 * Recibe las lecturas recientes de esa cámara — ya traídas, para no consultar una vez por
 * estadía — y cuenta cuántas ráfagas distintas hubo después de la última vez que se vio a
 * este vehículo. Las lecturas del mismo vehículo no cuentan (esas lo habrían extendido), y
 * las de una misma ráfaga tampoco se cuentan dos veces: llegan con el mismo instante.
 */
export function miradasSinVerlo(
    fila: { plate: string; estHasta: Date | null },
    lecturasDeLaCamara: { plate: string; timestamp: Date }[],
) {
    const desde = fila.estHasta?.getTime() ?? 0;
    const instantes = new Set<number>();
    for (const l of lecturasDeLaCamara) {
        if (l.timestamp.getTime() <= desde) continue;
        if (mismaChapa(l.plate, fila.plate)) continue;
        // Una ráfaga resuelve varias matrículas con el mismo instante, o casi: se redondea
        // a diez segundos para que cuente como una sola mirada.
        instantes.add(Math.round(l.timestamp.getTime() / 10000));
    }
    return instantes.size;
}

/**
 * Las estadías abiertas de esa matrícula en esa cámara, confirmadas o no.
 *
 * Entran también las que todavía están en VISTO: una estadía que no llegó al mínimo sigue
 * siendo una fila abierta que hay que cerrar cuando el auto arranca, aunque al cerrarse no
 * avise nada. Dejarlas afuera las volvía inmortales.
 *
 * Se buscan por PARECIDO y no por texto exacto, por el mismo motivo por el que se
 * enganchan así las lecturas: una estadía abierta bajo `AAU90` es la del auto que ahora
 * se lee `AAU9032`, y con igualdad exacta quedaba abierta para siempre — el auto se iba,
 * la fila no se cerraba, y el panel seguía mostrándolo estacionado.
 *
 * El filtro por cámara ya acota mucho el universo, así que traer las abiertas de ese
 * equipo y compararlas en memoria cuesta lo mismo y no deja huérfanas.
 */
export async function estadiasAbiertas(plate: string, deviceId: string | null) {
    const abiertas = await prisma.plateSighting.findMany({
        where: { deviceId, source: "TRACK", estado: { in: ESTADOS_DE_ESTADIA }, estCerrada: false },
        orderBy: { timestamp: "desc" },
        take: 60,
    });
    return abiertas.filter((f) => mismaChapa(f.plate, plate));
}
