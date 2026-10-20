import { prisma } from "@/lib/prisma";
import {
    CANAL_AFORO_RX, CANAL_ENTRADA, CANAL_SALIDA, LIMITE_FILA_POR_DEFECTO, VENTANA_ESPERA_MIN,
} from "@/lib/filas/constantes";
import { DESFASAJE_UY_MS } from "@/lib/filas/horario";

/**
 * Cómo viene una fila en este momento: lo que lleva el aviso de Telegram y lo que muestran la
 * tabla de Filas y las pantallas. Un solo cálculo, para que el mensaje y la pantalla no digan
 * dos esperas distintas.
 */

/** El límite de cada fila: la menor de sus alertas de aforo habilitadas (como avisa el servidor). */
export async function limitesPorFila(): Promise<Record<string, number>> {
    const alertas = await prisma.queueAlert.findMany({ where: { enabled: true, deviceId: { not: null } } });
    const out: Record<string, number> = {};
    for (const a of alertas) {
        if (a.channelName && !CANAL_AFORO_RX.test(a.channelName)) continue;
        out[a.deviceId!] = Math.min(out[a.deviceId!] ?? Infinity, a.threshold);
    }
    return out;
}

export async function limiteDeFila(deviceId: string): Promise<number> {
    return (await limitesPorFila())[deviceId] ?? LIMITE_FILA_POR_DEFECTO;
}

/** Medianoche de hoy en Montevideo, como instante. */
export function inicioDelDiaUy(t = new Date()): Date {
    const u = new Date(t.getTime() - DESFASAJE_UY_MS);
    return new Date(Date.UTC(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()) + DESFASAJE_UY_MS);
}

/** Cuánto atrás se mira para saber desde cuándo está sobre el límite. Más que esto se dice «más de». */
const MIRAR_ATRAS_MIN = 180;
/**
 * Bajadas más cortas que esto no cortan el «sobre el límite desde»: la Bosch parpadea un valor
 * cuando alguien queda en el borde de la zona, y la fila no se vació por eso.
 */
export const EPISODIO_UNION_SEG = 60;

export type DemoraFila = {
    aforo: number | null;
    limite: number;
    /** Minutos de espera estimada (personas ÷ ritmo de salidas), o null sin salidas recientes. */
    esperaMin: number | null;
    entradas15: number;
    salidas15: number;
    /** Desde cuándo está en el límite o arriba, o null si no lo está. */
    sobreDesde: Date | null;
    llenasHoy: number;
    picoHoy: number;
    picoHoyA: Date | null;
};

export async function demoraFila(deviceId: string, ahora = new Date()): Promise<DemoraFila> {
    const limite = await limiteDeFila(deviceId);
    const desde15 = new Date(ahora.getTime() - VENTANA_ESPERA_MIN * 60_000);
    const hoy0 = inicioDelDiaUy(ahora);
    const atras = new Date(ahora.getTime() - MIRAR_ATRAS_MIN * 60_000);
    const noCruce = { NOT: { channelName: { in: [CANAL_ENTRADA, CANAL_SALIDA] } } };
    const [recientes, hoy, entradas15, salidas15] = await Promise.all([
        prisma.queueEvent.findMany({ where: { deviceId, timestamp: { gte: atras, lte: ahora }, ...noCruce }, orderBy: { timestamp: "desc" }, select: { peopleCount: true, timestamp: true } }),
        prisma.queueEvent.findMany({ where: { deviceId, timestamp: { gte: hoy0, lte: ahora }, ...noCruce }, orderBy: { timestamp: "asc" }, select: { peopleCount: true, timestamp: true } }),
        prisma.queueEvent.count({ where: { deviceId, channelName: CANAL_ENTRADA, timestamp: { gte: desde15, lte: ahora } } }),
        prisma.queueEvent.count({ where: { deviceId, channelName: CANAL_SALIDA, timestamp: { gte: desde15, lte: ahora } } }),
    ]);
    const aforo = recientes[0]?.peopleCount ?? null;

    // Desde cuándo: hacia atrás mientras siga en el límite, perdonando bajadas cortas.
    let sobreDesde: Date | null = null;
    if (aforo != null && aforo >= limite) {
        sobreDesde = recientes[0].timestamp;
        let bajoDesde: Date | null = null;
        for (const e of recientes) {
            if (e.peopleCount >= limite) { sobreDesde = e.timestamp; bajoDesde = null; continue; }
            bajoDesde = e.timestamp;
            if (sobreDesde.getTime() - bajoDesde.getTime() > EPISODIO_UNION_SEG * 1000) break;
        }
    }

    let llenas = 0, antes = 0, ultimaSalida = 0, pico = 0, picoA: Date | null = null;
    for (const e of hoy) {
        if (e.peopleCount >= limite && antes < limite && e.timestamp.getTime() - ultimaSalida > EPISODIO_UNION_SEG * 1000) llenas++;
        if (e.peopleCount < limite && antes >= limite) ultimaSalida = e.timestamp.getTime();
        if (e.peopleCount > pico) { pico = e.peopleCount; picoA = e.timestamp; }
        antes = e.peopleCount;
    }
    const porMin = salidas15 / VENTANA_ESPERA_MIN;
    return {
        aforo, limite,
        esperaMin: aforo != null && porMin > 0 ? Math.max(1, Math.round(aforo / porMin)) : null,
        entradas15, salidas15, sobreDesde, llenasHoy: llenas, picoHoy: pico, picoHoyA: picoA,
    };
}
