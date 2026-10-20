"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { CANAL_ENTRADA, CANAL_SALIDA } from "@/lib/filas/constantes";
import { enMontevideo } from "@/lib/filas/horario";

/**
 * Validar el conteo (HB, 20/10): una persona cuenta a ciegas la gente de una captura y se compara
 * con lo que dijo la cámara. Es la precisión DOCUMENTADA del contador: lo primero que pide quien
 * compra un sistema de filas, y lo que hoy no teníamos (el calibrador midió 52% de parpadeo del
 * aforo y en tres días hubo 524 entradas contra 316 salidas: había que poner números).
 *
 * A ciegas de verdad: lo que dijo la cámara no viaja al navegador hasta que la persona contestó
 * (lo devuelve guardarValidacion). Mostrado de entrada, el número arrastra la respuesta.
 */

async function exigirSesion() {
    const s = await getSession();
    if (!s) throw new Error("Necesitás iniciar sesión");
    return s as any;
}

/**
 * Tramos de «cuánta gente dijo la cámara». Se elige un tramo al azar entre los que tienen
 * capturas sin validar y después una captura al azar dentro: si se sortearan capturas directo,
 * casi todas serían de 1 persona (es lo más frecuente en HB) y la precisión con la fila cargada,
 * que es la que importa, quedaría sin medir.
 */
const TRAMOS: [number, number][] = [[1, 1], [2, 2], [3, 3], [4, 5], [6, 9999]];
/** Se prefieren capturas recientes (la cámara pudo recalibrarse); si no queda nada, cualquiera. */
const DIAS_RECIENTES = 14;
/** Peores casos que se listan en el resumen. */
const PEORES = 10;

const filtroBase = `e."snapshotPath" is not null and e."channelName" not in ($1, $2)
    and ($3::text is null or e."deviceId" = $3)
    and not exists (select 1 from "ValidacionConteo" v where v."eventId" = e.id)
    and not (e.id = any($5::text[]))`;

export type CapturaAValidar = { eventId: string; deviceId: string; fila: string; momento: string; foto: string; quedan: number };

export async function siguienteCaptura(p: { deviceId?: string | null; excluir?: string[] } = {}): Promise<CapturaAValidar | null> {
    await exigirSesion();
    const dev = p.deviceId || null;
    const excluir = (p.excluir || []).slice(-500);
    for (const desde of [new Date(Date.now() - DIAS_RECIENTES * 24 * 3600_000), new Date(0)]) {
        const porTramo = await prisma.$queryRawUnsafe<{ tramo: number; n: number }[]>(`
            select case ${TRAMOS.map(([a, b], i) => `when e."peopleCount" between ${a} and ${b} then ${i}`).join(" ")} else -1 end as tramo,
                   count(*)::int as n
            from "QueueEvent" e where ${filtroBase} and e."timestamp" >= $4 group by 1`,
            CANAL_ENTRADA, CANAL_SALIDA, dev, desde, excluir);
        const disponibles = porTramo.filter((t) => t.tramo >= 0 && t.n > 0);
        if (!disponibles.length) continue;
        const elegido = disponibles[Math.floor(Math.random() * disponibles.length)];
        const [a, b] = TRAMOS[elegido.tramo];
        const filas = await prisma.$queryRawUnsafe<{ id: string; deviceId: string; timestamp: Date; snapshotPath: string }[]>(`
            select e.id, e."deviceId", e."timestamp", e."snapshotPath" from "QueueEvent" e
            where ${filtroBase} and e."timestamp" >= $4 and e."peopleCount" between $6 and $7
            order by random() limit 1`,
            CANAL_ENTRADA, CANAL_SALIDA, dev, desde, excluir, a, b);
        const e = filas[0];
        if (!e) continue;
        const d = await prisma.device.findUnique({ where: { id: e.deviceId }, select: { name: true } });
        return {
            eventId: e.id, deviceId: e.deviceId, fila: d?.name || "Fila",
            momento: new Date(e.timestamp).toISOString(), foto: e.snapshotPath,
            quedan: disponibles.reduce((s, t) => s + t.n, 0),
        };
    }
    return null;
}

/** Guarda lo que contó la persona y RECIÉN AHÍ devuelve lo que dijo la cámara. */
export async function guardarValidacion(p: { eventId: string; humano: number; nota?: string | null }) {
    const s = await exigirSesion();
    const humano = Math.round(Number(p.humano));
    if (!Number.isFinite(humano) || humano < 0 || humano > 200) throw new Error("La cantidad tiene que ser un número entre 0 y 200");
    const e = await prisma.queueEvent.findUnique({ where: { id: p.eventId }, select: { id: true, deviceId: true, timestamp: true, snapshotPath: true, peopleCount: true } });
    if (!e) throw new Error("Esa lectura ya no existe");
    const ya = await prisma.validacionConteo.findFirst({ where: { eventId: e.id }, select: { id: true } });
    const datos = {
        eventId: e.id, deviceId: e.deviceId, momento: e.timestamp, fotoPath: e.snapshotPath,
        camara: e.peopleCount, humano, usuario: (s?.name as string) || null, nota: (p.nota || "").trim().slice(0, 300) || null,
    };
    const v = ya
        ? await prisma.validacionConteo.update({ where: { id: ya.id }, data: datos })
        : await prisma.validacionConteo.create({ data: datos });
    return { id: v.id, camara: e.peopleCount, humano };
}

export async function borrarValidacion(id: string) {
    await exigirSesion();
    await prisma.validacionConteo.delete({ where: { id } });
    return { ok: true };
}

export type Validacion = { id: string; momento: string; fila: string; deviceId: string; foto: string | null; camara: number; humano: number; usuario: string | null; nota: string | null; creada: string };

export async function listarValidaciones(p: { deviceId?: string | null; desde?: string | null; take?: number } = {}): Promise<Validacion[]> {
    await exigirSesion();
    const filas = await prisma.validacionConteo.findMany({
        where: { ...(p.deviceId ? { deviceId: p.deviceId } : {}), ...(p.desde ? { createdAt: { gte: new Date(p.desde) } } : {}) },
        orderBy: { createdAt: "desc" }, take: Math.min(Math.max(p.take || 500, 1), 2000),
    });
    const nombres = Object.fromEntries((await prisma.device.findMany({ where: { id: { in: [...new Set(filas.map((f) => f.deviceId))] } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]));
    return filas.map((f) => ({
        id: f.id, momento: f.momento.toISOString(), fila: nombres[f.deviceId] || "Fila", deviceId: f.deviceId, foto: f.fotoPath,
        camara: f.camara, humano: f.humano, usuario: f.usuario, nota: f.nota, creada: f.createdAt.toISOString(),
    }));
}

export type ResumenValidacion = {
    n: number;
    exactas: number;            // proporción 0..1
    dentroDeUno: number;        // proporción 0..1
    errorMedio: number;         // personas, |cámara − humano| promedio
    sesgo: number;              // personas, (cámara − humano) promedio: + = cuenta de más
    mape: number | null;        // proporción, sólo donde humano > 0
    confusion: { camara: number; humano: number; n: number }[];
    porHora: { hora: number; n: number; exactas: number; errorMedio: number }[];
    peores: Validacion[];
};

export async function resumenValidacion(p: { deviceId?: string | null; desde?: string | null } = {}): Promise<ResumenValidacion> {
    const lista = await listarValidaciones({ ...p, take: 2000 });
    const n = lista.length;
    if (!n) return { n: 0, exactas: 0, dentroDeUno: 0, errorMedio: 0, sesgo: 0, mape: null, confusion: [], porHora: [], peores: [] };
    const dif = (v: Validacion) => v.camara - v.humano;
    const conGente = lista.filter((v) => v.humano > 0);
    const conf = new Map<string, { camara: number; humano: number; n: number }>();
    const horas = new Map<number, { n: number; exactas: number; abs: number }>();
    for (const v of lista) {
        const k = `${v.camara}:${v.humano}`;
        const c = conf.get(k) || { camara: v.camara, humano: v.humano, n: 0 }; c.n++; conf.set(k, c);
        const h = Number(enMontevideo(new Date(v.momento)).hhmm.slice(0, 2));
        const x = horas.get(h) || { n: 0, exactas: 0, abs: 0 }; x.n++; if (dif(v) === 0) x.exactas++; x.abs += Math.abs(dif(v)); horas.set(h, x);
    }
    const redondo = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
    return {
        n,
        exactas: redondo(lista.filter((v) => dif(v) === 0).length / n, 4),
        dentroDeUno: redondo(lista.filter((v) => Math.abs(dif(v)) <= 1).length / n, 4),
        errorMedio: redondo(lista.reduce((s, v) => s + Math.abs(dif(v)), 0) / n),
        sesgo: redondo(lista.reduce((s, v) => s + dif(v), 0) / n),
        mape: conGente.length ? redondo(conGente.reduce((s, v) => s + Math.abs(dif(v)) / v.humano, 0) / conGente.length, 4) : null,
        confusion: [...conf.values()].sort((a, b) => a.camara - b.camara || a.humano - b.humano),
        porHora: [...horas.entries()].sort((a, b) => a[0] - b[0]).map(([hora, x]) => ({ hora, n: x.n, exactas: redondo(x.exactas / x.n, 4), errorMedio: redondo(x.abs / x.n) })),
        peores: [...lista].filter((v) => dif(v) !== 0).sort((a, b) => Math.abs(dif(b)) - Math.abs(dif(a))).slice(0, PEORES),
    };
}

/** Las filas para el filtro (sólo contadores de fila). */
export async function filasParaValidar() {
    await exigirSesion();
    return prisma.device.findMany({ where: { deviceType: "QUEUE_COUNTER" }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}
