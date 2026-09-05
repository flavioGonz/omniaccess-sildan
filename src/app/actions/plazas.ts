"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import * as fs from 'fs';
import * as path from 'path';

export async function getParkingSlots() {
    try {
        const slots = await prisma.parkingSlot.findMany({
            orderBy: { createdAt: 'asc' }
        });

        // Parse points JSON string to array
        return slots.map(slot => ({
            ...slot,
            points: slot.points ? JSON.parse(slot.points) : []
        }));
    } catch (error) {
        console.error("Error fetching parking slots:", error);
        return [];
    }
}

/**
 * Guarda el plano de plazas.
 *
 * Va en UNA transacción, con upsert por id y borrado solo de las que ya no están.
 * Antes hacía deleteMany({}) + create uno por uno: si fallaba a mitad —o si el
 * cliente mandaba una lista incompleta— el barrio se quedaba sin mapa.
 */
export async function saveParkingSlots(slotsJson: string) {
    try {
        const slots = JSON.parse(slotsJson);
        if (!Array.isArray(slots)) return { success: false, error: "Formato inválido" };

        // Red de seguridad: nunca vaciar el plano de un saque por un estado vacío del cliente.
        const actuales = await prisma.parkingSlot.count();
        if (slots.length === 0 && actuales > 0) {
            return { success: false, error: "No se guardó: la lista llegó vacía y hay " + actuales + " plazas dibujadas." };
        }

        const vivos = slots.map((s: any) => s.id).filter(Boolean);
        await prisma.$transaction([
            ...slots.map((slot: any) => {
                const datos = {
                    label: String(slot.label ?? ""),
                    isOccupied: !!slot.isOccupied,
                    unitId: slot.unitId || null,
                    points: JSON.stringify(slot.points || []),
                    x: slot.points?.[0]?.x || 0,
                    y: slot.points?.[0]?.y || 0,
                    width: 0,
                    height: 0,
                };
                return prisma.parkingSlot.upsert({
                    where: { id: slot.id },
                    update: datos,
                    create: { id: slot.id, ...datos },
                });
            }),
            prisma.parkingSlot.deleteMany({ where: { id: { notIn: vivos } } }),
        ]);

        revalidatePath("/admin/plazas");
        return { success: true, message: `${slots.length} plazas guardadas` };
    } catch (error: any) {
        console.error("Error saving parking slots:", error);
        return { success: false, error: error.message || "Failed to save slots" };
    }
}

export async function updateSlotStatus(id: string, isOccupied: boolean) {
    try {
        await prisma.parkingSlot.update({
            where: { id },
            data: { isOccupied }
        });
        revalidatePath("/admin/plazas");
        return { success: true };
    } catch (error) {
        console.error("Error updating slot status:", error);
        return { success: false };
    }
}

export async function getParkingMap() {
    const setting = await prisma.setting.findUnique({ where: { key: "parking_map_url" } });
    return setting?.value || null;
}

import { uploadToS3 } from "@/lib/s3";

export async function uploadParkingMap(formData: FormData) {
    const file = formData.get("file") as File;
    if (!file) throw new Error("No file provided");

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const filename = `maps/parking_map_${Date.now()}.png`;
    const url = await uploadToS3(buffer, filename, file.type || "image/png", "lpr");

    await prisma.setting.upsert({
        where: { key: "parking_map_url" },
        update: { value: url },
        create: { key: "parking_map_url", value: url }
    });

    revalidatePath("/admin/plazas");
    return url;
}

export async function getParkingElements() {
    try {
        const s = await prisma.setting.findUnique({ where: { key: "parking_map_elements" } });
        if (!s?.value) return { entradas: [], salidas: [], calles: [] };
        const d = JSON.parse(s.value);
        return { entradas: d.entradas || [], salidas: d.salidas || [], calles: d.calles || [] };
    } catch {
        return { entradas: [], salidas: [], calles: [] };
    }
}

export async function saveParkingElements(json: string) {
    try {
        const d = JSON.parse(json);
        const clean = { entradas: d.entradas || [], salidas: d.salidas || [], calles: d.calles || [] };
        await prisma.setting.upsert({
            where: { key: "parking_map_elements" },
            update: { value: JSON.stringify(clean) },
            create: { key: "parking_map_elements", value: JSON.stringify(clean) },
        });
        revalidatePath("/admin/plazas");
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e?.message };
    }
}


/* ───────────────────────── Presencia por lote ─────────────────────────
 *
 * Cada plaza es en realidad un lote. El estado NO dice si el lugar está
 * físicamente ocupado, sino si el vehículo de esa casa está dentro del predio,
 * según la última lectura de matrícula:
 *
 *   "in"   → al menos un vehículo del lote entró y no salió
 *   "out"  → el lote tiene vehículos y todos están afuera
 *   "none" → el lote no tiene ningún vehículo cargado
 */
export type SlotOccupancy = {
    status: "in" | "out" | "none";
    inside: string[];            // matrículas dentro del predio
    outside: string[];           // matrículas fuera
    all: string[];
    since?: string;              // desde cuándo rige el estado (ISO)
    lastPlate?: string;          // qué matrícula lo definió
    lastDir?: "ENTRY" | "EXIT";
    lastCamera?: string;
};

/** Último movimiento conocido de cada matrícula. */
type UltimoMov = { dir: string; ts: Date; deviceId: string | null };

// El monitor pide la presencia con cada evento de socket. Sin este cache, cada
// captura del barrio disparaba una consulta sobre toda la tabla de accesos.
const CACHE_MS = 4000;
let cache: { t: number; datos: Record<string, SlotOccupancy> } | null = null;

/** Arma el mapa lote → matrículas, por asignación directa o por unidad. */
async function matriculasPorPlaza() {
    const [slots, users] = await Promise.all([
        prisma.parkingSlot.findMany({ select: { id: true, unitId: true } }),
        prisma.user.findMany({
            where: { OR: [{ parkingSlotId: { not: null } }, { unitId: { not: null } }] },
            select: { parkingSlotId: true, unitId: true, vehicles: { select: { plate: true } } },
        }),
    ]);
    const porPlaza: Record<string, Set<string>> = {};
    const add = (slotId: string, plate: string) => { (porPlaza[slotId] ||= new Set()).add(plate.toUpperCase()); };
    for (const u of users) if (u.parkingSlotId) u.vehicles.forEach((v) => add(u.parkingSlotId as string, v.plate));

    const porUnidad: Record<string, string[]> = {};
    for (const u of users) if (u.unitId) u.vehicles.forEach((v) => (porUnidad[u.unitId as string] ||= []).push(v.plate));
    for (const s of slots) if (s.unitId && porUnidad[s.unitId] && !porPlaza[s.id]) porUnidad[s.unitId].forEach((p) => add(s.id, p));

    // los lotes sin vehículo también entran, para poder distinguirlos de los que no existen
    for (const s of slots) porPlaza[s.id] ||= new Set();
    return porPlaza;
}

/** Último movimiento de cada matrícula de la lista (una sola consulta). */
async function ultimosMovimientos(plates: string[], hasta?: Date): Promise<Record<string, UltimoMov>> {
    if (!plates.length) return {};
    const rows: any[] = hasta
        ? await prisma.$queryRaw`SELECT DISTINCT ON ("plateDetected") "plateDetected", direction, "timestamp", "deviceId"
             FROM "AccessEvent" WHERE "plateDetected" = ANY(${plates}) AND "timestamp" <= ${hasta}
             ORDER BY "plateDetected", "timestamp" DESC`
        : await prisma.$queryRaw`SELECT DISTINCT ON ("plateDetected") "plateDetected", direction, "timestamp", "deviceId"
             FROM "AccessEvent" WHERE "plateDetected" = ANY(${plates})
             ORDER BY "plateDetected", "timestamp" DESC`;
    const out: Record<string, UltimoMov> = {};
    for (const r of rows) out[(r.plateDetected || "").toUpperCase()] = { dir: r.direction, ts: r.timestamp, deviceId: r.deviceId };
    return out;
}

/**
 * Presencia de cada lote.
 * @param hasta reconstruye el estado a un momento pasado (deslizador de hora).
 */
export async function getParkingOccupancy(hasta?: string | null): Promise<Record<string, SlotOccupancy>> {
    try {
        const corte = hasta ? new Date(hasta) : undefined;
        if (!corte && cache && Date.now() - cache.t < CACHE_MS) return cache.datos;

        const porPlaza = await matriculasPorPlaza();
        const todas = [...new Set(Object.values(porPlaza).flatMap((s) => [...s]))];
        const mov = await ultimosMovimientos(todas, corte);

        const devs = await prisma.device.findMany({ select: { id: true, name: true } });
        const nombreDev: Record<string, string> = Object.fromEntries(devs.map((d) => [d.id, d.name]));

        const result: Record<string, SlotOccupancy> = {};
        for (const [slotId, set] of Object.entries(porPlaza)) {
            const plates = [...set];
            const inside = plates.filter((p) => mov[p]?.dir === "ENTRY");
            const outside = plates.filter((p) => mov[p] && mov[p].dir !== "ENTRY");
            // el movimiento más reciente del lote es el que explica el estado
            const ultimo = plates
                .filter((p) => mov[p])
                .sort((a, b) => +new Date(mov[b].ts) - +new Date(mov[a].ts))[0];
            result[slotId] = {
                status: inside.length ? "in" : (plates.length ? "out" : "none"),
                inside, outside, all: plates,
                ...(ultimo ? {
                    since: new Date(mov[ultimo].ts).toISOString(),
                    lastPlate: ultimo,
                    lastDir: mov[ultimo].dir === "ENTRY" ? "ENTRY" as const : "EXIT" as const,
                    lastCamera: mov[ultimo].deviceId ? nombreDev[mov[ultimo].deviceId!] : undefined,
                } : {}),
            };
        }
        if (!corte) cache = { t: Date.now(), datos: result };
        return result;
    } catch (e) {
        console.error("[getParkingOccupancy]", e);
        return {};
    }
}

/** El sector es el prefijo de la etiqueta del lote: "A-12" → "A". */
const sectorDe = (label: string) => (label || "").split(/[-\s]/)[0].toUpperCase() || "—";

export type PresenceSummary = {
    total: number; adentro: number; afuera: number; sinVehiculo: number;
    sectores: { sector: string; total: number; adentro: number }[];
};

/** Resumen para el encabezado: cuántas casas tienen el auto adentro, y por sector. */
export async function getPresenceSummary(): Promise<PresenceSummary> {
    const [slots, occ] = await Promise.all([
        prisma.parkingSlot.findMany({ select: { id: true, label: true } }),
        getParkingOccupancy(),
    ]);
    const porSector: Record<string, { total: number; adentro: number }> = {};
    let adentro = 0, afuera = 0, sinVehiculo = 0;
    for (const s of slots) {
        const e = occ[s.id]?.status ?? "none";
        if (e === "in") adentro++; else if (e === "out") afuera++; else sinVehiculo++;
        const k = sectorDe(s.label);
        (porSector[k] ||= { total: 0, adentro: 0 }).total++;
        if (e === "in") porSector[k].adentro++;
    }
    return {
        total: slots.length, adentro, afuera, sinVehiculo,
        sectores: Object.entries(porSector).map(([sector, v]) => ({ sector, ...v })).sort((a, b) => a.sector.localeCompare(b.sector)),
    };
}

export type SlotDetail = {
    id: string; label: string; sector: string;
    unidad: string | null;
    residentes: { id: string; nombre: string; matriculas: string[] }[];
    ocupacion: SlotOccupancy | null;
    movimientos: { id: string; plate: string | null; dir: string; ts: string; camara: string | null; foto: string | null; decision: string | null }[];
};

/** Ficha del lote: quién vive, qué autos tiene y sus últimos movimientos. */
export async function getSlotDetail(slotId: string, limite = 12): Promise<SlotDetail | null> {
    try {
        const slot = await prisma.parkingSlot.findUnique({
            where: { id: slotId },
            select: { id: true, label: true, unitId: true, unit: { select: { name: true } } },
        });
        if (!slot) return null;

        const users = await prisma.user.findMany({
            where: { OR: [{ parkingSlotId: slotId }, ...(slot.unitId ? [{ unitId: slot.unitId }] : [])] },
            select: { id: true, name: true, vehicles: { select: { plate: true } } },
        });
        const residentes = users.map((u) => ({ id: u.id, nombre: u.name || "Sin nombre", matriculas: u.vehicles.map((v) => v.plate.toUpperCase()) }));
        const plates = [...new Set(residentes.flatMap((r) => r.matriculas))];

        const eventos = plates.length
            ? await prisma.accessEvent.findMany({
                where: { plateDetected: { in: plates } },
                orderBy: { timestamp: "desc" }, take: limite,
                select: { id: true, plateDetected: true, direction: true, timestamp: true, snapshotPath: true, decision: true, device: { select: { name: true } } },
            })
            : [];

        const occ = (await getParkingOccupancy())[slotId] ?? null;
        return {
            id: slot.id, label: slot.label, sector: sectorDe(slot.label),
            unidad: slot.unit?.name ?? null,
            residentes, ocupacion: occ,
            movimientos: eventos.map((e) => ({
                id: e.id, plate: e.plateDetected, dir: e.direction, ts: e.timestamp.toISOString(),
                camara: e.device?.name ?? null, foto: e.snapshotPath ?? null, decision: (e as any).decision ?? null,
            })),
        };
    } catch (e) {
        console.error("[getSlotDetail]", e);
        return null;
    }
}

export type PresenceInsights = {
    adentroHaceMucho: { slotId: string; label: string; plate: string; desde: string; dias: number }[];
    sinMovimiento: { slotId: string; label: string; desde: string | null; dias: number | null }[];
    noIdentificadosAdentro: { plate: string; desde: string; horas: number; camara: string | null }[];
};

/**
 * Lo que hay que mirar, no lo que hay que contar.
 * @param diasAdentro   un auto del barrio que entró y no salió hace más de N días
 * @param diasQuietos   un lote sin ningún movimiento hace más de N días (casa vacía)
 */
export async function getPresenceInsights(diasAdentro = 4, diasQuietos = 21): Promise<PresenceInsights> {
    const vacio: PresenceInsights = { adentroHaceMucho: [], sinMovimiento: [], noIdentificadosAdentro: [] };
    try {
        const [slots, occ] = await Promise.all([
            prisma.parkingSlot.findMany({ select: { id: true, label: true } }),
            getParkingOccupancy(),
        ]);
        const ahora = Date.now();
        const dias = (iso: string) => Math.floor((ahora - +new Date(iso)) / 86400000);

        const adentroHaceMucho: PresenceInsights["adentroHaceMucho"] = [];
        const sinMovimiento: PresenceInsights["sinMovimiento"] = [];
        for (const s of slots) {
            const o = occ[s.id];
            if (!o || !o.all.length) continue;
            if (o.status === "in" && o.since && dias(o.since) >= diasAdentro) {
                adentroHaceMucho.push({ slotId: s.id, label: s.label, plate: o.inside[0] || o.lastPlate || "", desde: o.since, dias: dias(o.since) });
            }
            if (!o.since) sinMovimiento.push({ slotId: s.id, label: s.label, desde: null, dias: null });
            else if (dias(o.since) >= diasQuietos) sinMovimiento.push({ slotId: s.id, label: s.label, desde: o.since, dias: dias(o.since) });
        }

        // Vehículos que entraron y no salieron y que NO pertenecen a ningún lote.
        const conocidas = new Set(Object.values(occ).flatMap((o) => o.all));
        const desde = new Date(ahora - 7 * 86400000);
        const filas: any[] = await prisma.$queryRaw`
            SELECT DISTINCT ON (e."plateDetected") e."plateDetected", e.direction, e."timestamp", d.name AS camara
            FROM "AccessEvent" e LEFT JOIN "Device" d ON d.id = e."deviceId"
            WHERE e."plateDetected" IS NOT NULL AND e."plateDetected" <> '' AND e."timestamp" >= ${desde}
            ORDER BY e."plateDetected", e."timestamp" DESC`;
        const noIdentificadosAdentro = filas
            .filter((r) => r.direction === "ENTRY" && !conocidas.has((r.plateDetected || "").toUpperCase()) && !/^NO_?LEIDA$/i.test(r.plateDetected || ""))
            .map((r) => ({
                plate: r.plateDetected, desde: new Date(r.timestamp).toISOString(),
                horas: Math.floor((ahora - +new Date(r.timestamp)) / 3600000), camara: r.camara ?? null,
            }))
            .sort((a, b) => b.horas - a.horas);

        return {
            adentroHaceMucho: adentroHaceMucho.sort((a, b) => b.dias - a.dias),
            sinMovimiento: sinMovimiento.sort((a, b) => (b.dias ?? 9999) - (a.dias ?? 9999)),
            noIdentificadosAdentro,
        };
    } catch (e) {
        console.error("[getPresenceInsights]", e);
        return vacio;
    }
}
