import { prisma } from "@/lib/prisma";
import { notificarEvento } from "@/lib/reglas-notificacion";

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

/** Sin verlo por más que esto, la estadía se cierra: el vehículo se fue. */
export const ESTADIA_VENCE_MIN = Number(process.env.TRACKING_PARKED_EXPIRE_MIN || 12);

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

/** Las estadías abiertas de esa matrícula en esa cámara. */
export function estadiasAbiertas(plate: string, deviceId: string | null) {
    return prisma.plateSighting.findMany({
        where: { plate, deviceId, source: "TRACK", estado: "ESTACIONADO", estCerrada: false },
        orderBy: { timestamp: "desc" },
    });
}
