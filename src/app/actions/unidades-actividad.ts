"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";

/**
 * Presencia y actividad de las unidades: qué vehículos de cada lote están adentro según la
 * última lectura de su matrícula, y la actividad reciente de una unidad (pasos con foto,
 * invitaciones vigentes). Las matrículas salen de los vehículos de los residentes y de sus
 * credenciales de tipo matrícula.
 */
export type PresenciaUnidad = {
    adentro: string[]; afuera: string[]; sinLectura: string[];
    ultimo?: { plate: string; dir: "ENTRY" | "EXIT"; ts: string; camara: string | null };
};

async function exigirSesion() { if (!(await getSession())) throw new Error("Hace falta una sesión del panel."); }

async function matriculasPorUnidad(unitId?: string) {
    const users = await prisma.user.findMany({
        where: unitId ? { unitId } : { unitId: { not: null } },
        select: { unitId: true, vehicles: { select: { plate: true } }, credentials: { where: { type: "PLATE" as any }, select: { value: true } } },
    });
    const porUnidad: Record<string, Set<string>> = {};
    for (const u of users) {
        const s = (porUnidad[u.unitId as string] ||= new Set());
        for (const v of u.vehicles) if (v.plate) s.add(v.plate.toUpperCase().replace(/[^A-Z0-9]/g, ""));
        for (const c of u.credentials) if (c.value) s.add(c.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
    }
    return porUnidad;
}

let cache: { t: number; v: Record<string, PresenciaUnidad> } | null = null;

export async function getPresenciaUnidades(): Promise<Record<string, PresenciaUnidad>> {
    await exigirSesion();
    if (cache && Date.now() - cache.t < 10_000) return cache.v;
    const porUnidad = await matriculasPorUnidad();
    const todas = [...new Set(Object.values(porUnidad).flatMap((s) => [...s]))].filter(Boolean);
    const filas: any[] = todas.length ? await prisma.$queryRaw`
        SELECT DISTINCT ON ("plateDetected") "plateDetected", direction, "timestamp", "deviceId"
        FROM "AccessEvent" WHERE "plateDetected" = ANY(${todas}) ORDER BY "plateDetected", "timestamp" DESC` : [];
    const devs = await prisma.device.findMany({ select: { id: true, name: true } });
    const nombre = Object.fromEntries(devs.map((d) => [d.id, d.name]));
    const mov: Record<string, { dir: string; ts: Date; deviceId: string | null }> = {};
    for (const f of filas) mov[String(f.plateDetected).toUpperCase()] = { dir: f.direction, ts: f.timestamp, deviceId: f.deviceId };
    const out: Record<string, PresenciaUnidad> = {};
    for (const [unitId, set] of Object.entries(porUnidad)) {
        const placas = [...set];
        const adentro = placas.filter((p) => mov[p]?.dir === "ENTRY");
        const afuera = placas.filter((p) => mov[p] && mov[p].dir !== "ENTRY");
        const sinLectura = placas.filter((p) => !mov[p]);
        const u = placas.filter((p) => mov[p]).sort((a, b) => +new Date(mov[b].ts) - +new Date(mov[a].ts))[0];
        out[unitId] = { adentro, afuera, sinLectura, ...(u ? { ultimo: { plate: u, dir: mov[u].dir === "ENTRY" ? "ENTRY" : "EXIT", ts: new Date(mov[u].ts).toISOString(), camara: mov[u].deviceId ? nombre[mov[u].deviceId!] || null : null } } : {}) };
    }
    cache = { t: Date.now(), v: out };
    return out;
}

export type ActividadUnidad = {
    movimientos: { id: string; plate: string | null; dir: string; ts: string; camara: string | null; foto: string | null; decision: string }[];
    invitaciones: { id: string; titulo: string; anfitrion: string; desde: string; hasta: string; invitados: string[]; via: string }[];
    pasosHoy: number; pasos7d: number;
};

export async function getActividadUnidad(unitId: string): Promise<ActividadUnidad> {
    await exigirSesion();
    const placas = [...((await matriculasPorUnidad(unitId))[unitId] || [])];
    const ahora = new Date();
    const hoy = new Date(ahora.getTime() - 3 * 3600_000); hoy.setUTCHours(3, 0, 0, 0); // medianoche de Montevideo
    if (hoy > ahora) hoy.setUTCDate(hoy.getUTCDate() - 1);
    const [eventos, pasosHoy, pasos7d, invs] = await Promise.all([
        placas.length ? prisma.accessEvent.findMany({
            where: { plateDetected: { in: placas } }, orderBy: { timestamp: "desc" }, take: 20,
            select: { id: true, plateDetected: true, direction: true, timestamp: true, snapshotPath: true, imagePath: true, decision: true, device: { select: { name: true } } },
        }) : Promise.resolve([] as any[]),
        placas.length ? prisma.accessEvent.count({ where: { plateDetected: { in: placas }, timestamp: { gte: hoy } } }) : Promise.resolve(0),
        placas.length ? prisma.accessEvent.count({ where: { plateDetected: { in: placas }, timestamp: { gte: new Date(ahora.getTime() - 7 * 86_400_000) } } }) : Promise.resolve(0),
        prisma.invitation.findMany({
            where: { hostUnitId: unitId, status: "ACTIVE" as any, validTo: { gte: ahora } }, orderBy: { validFrom: "asc" }, take: 20,
            select: { id: true, title: true, hostName: true, validFrom: true, validTo: true, createdVia: true, guests: { select: { name: true } } },
        }).catch(() => [] as any[]),
    ]);
    return {
        movimientos: eventos.map((e: any) => ({ id: e.id, plate: e.plateDetected, dir: e.direction, ts: e.timestamp.toISOString(), camara: e.device?.name || null, foto: e.snapshotPath || e.imagePath || null, decision: String(e.decision) })),
        invitaciones: invs.map((i: any) => ({ id: i.id, titulo: i.title || "Invitación", anfitrion: i.hostName || "", desde: i.validFrom.toISOString(), hasta: i.validTo.toISOString(), invitados: (i.guests || []).map((g: any) => g.name).filter(Boolean), via: i.createdVia })),
        pasosHoy, pasos7d,
    };
}
