import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { estadoFila } from "@/lib/filas/horario";
import { estadoDe, type FilaEnPantalla } from "@/lib/filas/pantalla-comun";

/**
 * Lo que muestra una pantalla de fila (kiosco), del lado del servidor.
 *
 * La pantalla abre sin sesión (/k/<slug>?t=<token>): un monitor de sala de espera no tiene quien
 * inicie sesión. Por eso los datos NO salen de una acción de servidor (las acciones sin sesión
 * están cerradas a propósito, ver lib/acciones-publicas) sino de /api/pantalla/<slug>, que
 * valida el token contra la base y devuelve sólo lo que se ve en la sala: nombre de la fila,
 * cuántos hay, el límite y la espera. Nada de IP, cámaras ni fotos.
 *
 * Las cuentas son las mismas que la tabla de Filas (getResumenFilas en actions/queue): se copian
 * acá en chico en vez de importarlas porque aquel archivo es "use server" y entero lo carga una
 * página pública si se lo importa.
 */

const CANAL_AFORO_RX = /aforo|occupancy|ocupaci/i;
const CANAL_ENTRADA = "Entrada";
const CANAL_SALIDA = "Salida";
/** Límite cuando la fila no tiene uno guardado (el mismo que usa la tabla de Filas). */
export const LIMITE_FILA_POR_DEFECTO = 10;
/** Ventana para la espera estimada: salidas de los últimos N minutos. */
const VENTANA_ESPERA_MIN = 15;
/** Corto (10 caracteres) para que la dirección se pueda tipear en el control remoto de una tele. */
export function nuevoToken(): string {
    return randomBytes(8).toString("base64url").slice(0, 10);
}

async function limitesPorFila(): Promise<Record<string, number>> {
    const alertas = await prisma.queueAlert.findMany({ where: { enabled: true, deviceId: { not: null } } });
    const out: Record<string, number> = {};
    for (const a of alertas) {
        if (a.channelName && !CANAL_AFORO_RX.test(a.channelName)) continue;
        out[a.deviceId!] = Math.min(out[a.deviceId!] ?? Infinity, a.threshold);
    }
    return out;
}

/** Las filas de una pantalla (vacío = todas), con lo de ahora. */
export async function filasDePantalla(deviceIds: string[]): Promise<FilaEnPantalla[]> {
    const devices = await prisma.device.findMany({
        where: { deviceType: "QUEUE_COUNTER", ...(deviceIds.length ? { id: { in: deviceIds } } : {}) },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
    });
    const [limites, horarios, especiales] = await Promise.all([
        limitesPorFila(),
        prisma.queueSchedule.findMany({ where: { enabled: true } }).catch(() => []),
        (prisma as any).queueDiaEspecial.findMany({ where: { fecha: { gte: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10) } } }).catch(() => []),
    ]);
    const desde15 = new Date(Date.now() - VENTANA_ESPERA_MIN * 60_000);
    const filas = await Promise.all(devices.map(async (d) => {
        const [ultimo, salidas15] = await Promise.all([
            prisma.queueEvent.findFirst({ where: { deviceId: d.id, NOT: { channelName: { in: [CANAL_ENTRADA, CANAL_SALIDA] } } }, orderBy: { timestamp: "desc" }, select: { peopleCount: true } }),
            prisma.queueEvent.count({ where: { deviceId: d.id, channelName: CANAL_SALIDA, timestamp: { gte: desde15 } } }),
        ]);
        const limite = limites[d.id] ?? LIMITE_FILA_POR_DEFECTO;
        const aforo = ultimo ? Math.max(0, ultimo.peopleCount) : null;
        const porMin = salidas15 / VENTANA_ESPERA_MIN;
        const h = estadoFila(horarios as any, especiales as any, d.id);
        const abierta = h.conHorario ? h.abierta : null;
        return {
            id: d.id, nombre: d.name, aforo, limite,
            esperaMin: aforo != null && porMin > 0 ? Math.round(aforo / porMin) : null,
            estado: estadoDe(aforo, limite, abierta),
            abierta,
        };
    }));
    // El orden que eligió quien armó la pantalla, si eligió.
    if (deviceIds.length) filas.sort((a, b) => deviceIds.indexOf(a.id) - deviceIds.indexOf(b.id));
    return filas;
}
