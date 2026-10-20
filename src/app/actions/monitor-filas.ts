"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";

/**
 * Datos del Monitor en vivo del modo Filas que no salían de ningún lado (HB, 19/10).
 *
 * El rediseño pidió dos cosas nuevas: la línea de los últimos 60 minutos en la tarjeta de cada
 * fila («¿viene subiendo o bajando?», que el número solo no dice) y los números del período
 * arriba de la gráfica, con lo que importa en una fila: cuántos se atendieron, cuántas veces se
 * llenó y cuánto tiempo estuvo llena. Los chips viejos («lecturas», «aforo promedio») contaban
 * eventos de la cámara, que no son personas.
 *
 * Va en su propio archivo para no tocar actions/queue.ts, que comparten otras pantallas.
 */

/** Lo mismo que usa el servidor para avisar (onvif-polling) cuando la fila no tiene alerta. */
const LIMITE_POR_DEFECTO = 10;
const ES_AFORO = /aforo|occupancy|ocupaci/i;
const CANAL_ENTRADA = "Entrada";
const CANAL_SALIDA = "Salida";
/** Uruguay: UTC−3, sin horario de verano. Los días del período se cortan en hora de Montevideo. */
const DESFASAJE_UY_MS = 3 * 3600_000;
/** Minutos de la línea de cada tarjeta. */
const MINUTOS_LINEA = 60;
/**
 * Un hueco entre lecturas más largo que esto no se cuenta como «tiempo sobre el límite»: la
 * Bosch manda sólo cuando cambia el valor, pero un corte de la cámara no es una fila llena.
 */
const HUECO_MAXIMO_MS = 10 * 60_000;
/** Tope de días del período: más que esto pesa y no se lee en la gráfica. */
const DIAS_MAXIMO = 120;

async function exigirSesion() {
    const s = await getSession();
    if (!s) throw new Error("La sesión venció: volvé a entrar.");
}

async function limitesPorFila(): Promise<Record<string, number>> {
    const alertas = await prisma.queueAlert.findMany({ where: { enabled: true, deviceId: { not: null } } });
    const out: Record<string, number> = {};
    for (const a of alertas) {
        if (a.channelName && !ES_AFORO.test(a.channelName)) continue;
        out[a.deviceId!] = Math.min(out[a.deviceId!] ?? Infinity, a.threshold);
    }
    return out;
}

/** AAAA-MM-DD → medianoche de ese día en Montevideo. */
function inicioDia(aaaammdd: string): Date {
    const [y, m, d] = aaaammdd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d) + DESFASAJE_UY_MS);
}

/**
 * La línea de los últimos 60 minutos por fila: el aforo al final de cada minuto (el último valor
 * conocido, que es lo que muestra la cámara) y el máximo dentro del minuto, para no perder un
 * pico corto. Arranca con el valor que traía de antes de la ventana.
 */
export async function getLineaReciente(): Promise<Record<string, { max: number[]; desde: string }>> {
    await exigirSesion();
    const ahora = Date.now();
    const desde = new Date(ahora - MINUTOS_LINEA * 60_000);
    const devices = await prisma.device.findMany({ where: { deviceType: "QUEUE_COUNTER" }, select: { id: true } });
    const out: Record<string, { max: number[]; desde: string }> = {};
    await Promise.all(devices.map(async (d) => {
        const noCruce = { NOT: { channelName: { in: [CANAL_ENTRADA, CANAL_SALIDA] } } };
        const [previo, eventos] = await Promise.all([
            prisma.queueEvent.findFirst({ where: { deviceId: d.id, timestamp: { lt: desde }, ...noCruce }, orderBy: { timestamp: "desc" }, select: { peopleCount: true } }),
            prisma.queueEvent.findMany({ where: { deviceId: d.id, timestamp: { gte: desde }, ...noCruce }, orderBy: { timestamp: "asc" }, select: { peopleCount: true, timestamp: true } }),
        ]);
        const max: number[] = [];
        let actual = previo?.peopleCount ?? 0, j = 0;
        for (let i = 0; i < MINUTOS_LINEA; i++) {
            const fin = desde.getTime() + (i + 1) * 60_000;
            let m = actual;
            while (j < eventos.length && eventos[j].timestamp.getTime() < fin) { actual = eventos[j].peopleCount; m = Math.max(m, actual); j++; }
            max.push(m);
        }
        out[d.id] = { max, desde: desde.toISOString() };
    }));
    return out;
}

export type KpisPeriodo = {
    entradas: number; salidas: number;
    pico: number; picoA: string | null; picoFila: string | null;
    promedio: number;
    vecesLlena: number; minutosSobre: number;
    lecturas: number;
};

/**
 * Los números del período elegido. `desde`/`hasta` son días AAAA-MM-DD (inclusive) en hora de
 * Montevideo; con una sola fecha es ese día.
 */
export async function getKpisPeriodo(p: { desde: string; hasta?: string; deviceId?: string }): Promise<KpisPeriodo> {
    await exigirSesion();
    const ini = inicioDia(p.desde);
    let fin = new Date(inicioDia(p.hasta || p.desde).getTime() + 24 * 3600_000);
    if (fin.getTime() - ini.getTime() > DIAS_MAXIMO * 24 * 3600_000) fin = new Date(ini.getTime() + DIAS_MAXIMO * 24 * 3600_000);
    const where: any = { timestamp: { gte: ini, lt: fin } };
    if (p.deviceId) where.deviceId = p.deviceId;

    const [entradas, salidas, eventos, limites, devices] = await Promise.all([
        prisma.queueEvent.count({ where: { ...where, channelName: CANAL_ENTRADA } }),
        prisma.queueEvent.count({ where: { ...where, channelName: CANAL_SALIDA } }),
        prisma.queueEvent.findMany({
            where: { ...where, NOT: { channelName: { in: [CANAL_ENTRADA, CANAL_SALIDA] } } },
            orderBy: { timestamp: "asc" }, select: { deviceId: true, peopleCount: true, timestamp: true },
        }),
        limitesPorFila(),
        prisma.device.findMany({ where: { deviceType: "QUEUE_COUNTER" }, select: { id: true, name: true } }),
    ]);

    let pico = 0, picoA: Date | null = null, picoDev: string | null = null, suma = 0, n = 0, veces = 0, sobreMs = 0;
    const previo = new Map<string, { v: number; t: number }>();
    const ahora = Date.now();
    for (const e of eventos) {
        const lim = limites[e.deviceId] ?? LIMITE_POR_DEFECTO;
        const t = e.timestamp.getTime();
        const ant = previo.get(e.deviceId);
        if (ant) {
            const dt = t - ant.t;
            if (ant.v >= lim && dt <= HUECO_MAXIMO_MS) sobreMs += dt;
            if (e.peopleCount >= lim && ant.v < lim) veces++;
        } else if (e.peopleCount >= lim) veces++;
        previo.set(e.deviceId, { v: e.peopleCount, t });
        if (e.peopleCount > pico) { pico = e.peopleCount; picoA = e.timestamp; picoDev = e.deviceId; }
        if (e.peopleCount > 0) { suma += e.peopleCount; n++; }
    }
    // La fila que sigue llena ahora: el tramo hasta ahora (o hasta el fin del período) también cuenta.
    for (const [id, ant] of previo) {
        const lim = limites[id] ?? LIMITE_POR_DEFECTO;
        const cierre = Math.min(fin.getTime(), ahora);
        if (ant.v >= lim && cierre - ant.t <= HUECO_MAXIMO_MS) sobreMs += Math.max(0, cierre - ant.t);
    }
    return {
        entradas, salidas,
        pico, picoA: picoA?.toISOString() ?? null, picoFila: devices.find((d) => d.id === picoDev)?.name ?? null,
        // Promedio de cuando HABÍA gente: con los ceros de la noche, todo da 0,3.
        promedio: n ? Math.round((suma / n) * 10) / 10 : 0,
        vecesLlena: veces, minutosSobre: Math.round(sobreMs / 60_000),
        lecturas: eventos.length,
    };
}
