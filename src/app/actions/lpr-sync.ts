"use server";

import { prisma } from "@/lib/prisma";
import { HikvisionDriver } from "@/lib/drivers/HikvisionDriver";
import { getSession } from "@/app/actions/auth";

// Sincronización de matrículas a las cámaras LPR — versión INCREMENTAL (diff).
// En vez de borrar toda la lista de la cámara y recargarla (disruptivo), leemos lo que
// la cámara ya tiene, lo comparamos con la base y sólo AGREGAMOS las que faltan y QUITAMOS
// las sobrantes. El borrado/alta es por matrícula (no por índice), así que no hace falta
// conocer la posición interna de cada registro.

const LOCK_KEY = "LPR_SYNC_LOCK";
const LOCK_TTL_MS = 20 * 60 * 1000; // el lock caduca solo a los 20 min por si un proceso muere

const norm = (s: string) => (s || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

async function readLock(): Promise<{ by: string; at: number } | null> {
    const row = await prisma.setting.findUnique({ where: { key: LOCK_KEY } });
    if (!row) return null;
    try {
        const v = JSON.parse(row.value);
        if (!v?.at || Date.now() - v.at > LOCK_TTL_MS) return null; // stale → se considera libre
        return v;
    } catch { return null; }
}

export async function getSyncLock() {
    return await readLock();
}

export async function acquireSyncLock() {
    const me = (await getSession() as any)?.name || "Admin";
    const cur = await readLock();
    if (cur && cur.by !== me) return { ok: false, by: cur.by, at: cur.at };
    const val = JSON.stringify({ by: me, at: Date.now() });
    await prisma.setting.upsert({ where: { key: LOCK_KEY }, update: { value: val }, create: { key: LOCK_KEY, value: val } });
    return { ok: true, by: me };
}

/** Refresca el timestamp del lock (heartbeat) mientras el proceso avanza. */
export async function touchSyncLock() {
    const me = (await getSession() as any)?.name || "Admin";
    const cur = await readLock();
    if (cur && cur.by !== me) return { ok: false, by: cur.by };
    await prisma.setting.upsert({ where: { key: LOCK_KEY }, update: { value: JSON.stringify({ by: me, at: Date.now() }) }, create: { key: LOCK_KEY, value: JSON.stringify({ by: me, at: Date.now() }) } });
    return { ok: true };
}

export async function releaseSyncLock() {
    try { await prisma.setting.delete({ where: { key: LOCK_KEY } }); } catch { }
    return { ok: true };
}

async function dbPlateSet(): Promise<Set<string>> {
    const creds = await prisma.credential.findMany({ where: { type: "PLATE" }, select: { value: true } });
    const s = new Set<string>();
    for (const c of creds) { const n = norm(c.value); if (n) s.add(n); }
    return s;
}

/** Analiza (sin tocar nada) cuántas matrículas tiene cada cámara y qué cambiaría. */
export async function getSyncPlan() {
    const devices = await prisma.device.findMany({ where: { deviceType: "LPR_CAMERA", brand: "HIKVISION" }, orderBy: { name: "asc" } });
    const db = await dbPlateSet();
    const driver = new HikvisionDriver();

    const perDevice = await Promise.all(devices.map(async (d) => {
        try {
            const cam = await driver.getPlates(d);
            const camSet = new Set<string>();
            for (const p of cam) { const n = norm(p); if (n) camSet.add(n); }
            let toAdd = 0, unchanged = 0;
            for (const p of db) { if (camSet.has(p)) unchanged++; else toAdd++; }
            let toRemove = 0;
            for (const p of camSet) { if (!db.has(p)) toRemove++; }
            return { id: d.id, name: d.name, ip: d.ip, direction: d.direction, online: true, currentCount: camSet.size, toAdd, toRemove, unchanged, error: null as string | null };
        } catch (e: any) {
            return { id: d.id, name: d.name, ip: d.ip, direction: d.direction, online: false, currentCount: 0, toAdd: db.size, toRemove: 0, unchanged: 0, error: e?.message || "sin conexión" };
        }
    }));

    return { dbCount: db.size, devices: perDevice, lock: await readLock() };
}

/** Sincroniza UN dispositivo por diferencia: agrega faltantes, quita sobrantes. NO borra todo. */
export async function syncDeviceIncremental(deviceId: string) {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device || device.brand !== "HIKVISION") return { ok: false, error: "Dispositivo no compatible", added: 0, addFail: 0, removed: 0, remFail: 0 };
    const driver = new HikvisionDriver();

    const creds = await prisma.credential.findMany({ where: { type: "PLATE" } });
    const byNorm = new Map<string, any>();
    for (const c of creds) { const n = norm(c.value); if (n && !byNorm.has(n)) byNorm.set(n, c); }
    const db = new Set(byNorm.keys());

    let cam: string[] = [];
    try { cam = await driver.getPlates(device); }
    catch (e: any) { return { ok: false, error: "No se pudo leer la cámara: " + (e?.message || ""), added: 0, addFail: 0, removed: 0, remFail: 0 }; }

    const camSet = new Set<string>();
    const camOrig = new Map<string, string>();
    for (const p of cam) { const n = norm(p); if (n) { camSet.add(n); if (!camOrig.has(n)) camOrig.set(n, p); } }

    const toAdd = [...db].filter((p) => !camSet.has(p));
    const toRemove = [...camSet].filter((p) => !db.has(p));

    let added = 0, addFail = 0, removed = 0, remFail = 0;
    for (const n of toAdd) {
        const c = byNorm.get(n);
        if (!c) continue;
        try { await driver.upsertCredential(c, device); added++; } catch { addFail++; }
    }
    for (const n of toRemove) {
        try { await driver.deleteCredential(camOrig.get(n) || n, device); removed++; } catch { remFail++; }
    }

    return { ok: true, added, addFail, removed, remFail, before: camSet.size, after: camSet.size + added - removed };
}

/** Reemplazo TOTAL de UN dispositivo (avanzado/reparación): borra la lista y recarga todo. */
export async function syncDeviceFull(deviceId: string) {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device || device.brand !== "HIKVISION") return { ok: false, error: "Dispositivo no compatible", added: 0, addFail: 0, removed: 0, remFail: 0 };
    const driver = new HikvisionDriver();
    const creds = await prisma.credential.findMany({ where: { type: "PLATE" } });
    let before = 0;
    try { before = (await driver.getPlates(device)).length; } catch { }
    try { await driver.clearWhiteList(device); } catch { }
    let added = 0, addFail = 0;
    for (const c of creds) { try { await driver.upsertCredential(c, device); added++; } catch { addFail++; } }
    return { ok: true, added, addFail, removed: before, remFail: 0, before, after: added };
}
