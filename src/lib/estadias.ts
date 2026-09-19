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
 * Las estadías abiertas de esa matrícula en esa cámara.
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
        where: { deviceId, source: "TRACK", estado: "ESTACIONADO", estCerrada: false },
        orderBy: { timestamp: "desc" },
        take: 60,
    });
    return abiertas.filter((f) => mismaChapa(f.plate, plate));
}
