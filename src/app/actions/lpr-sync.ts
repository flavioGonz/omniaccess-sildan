"use server";

import { prisma } from "@/lib/prisma";
import { HikvisionDriver } from "@/lib/drivers/HikvisionDriver";
import { matriculasParaCargar, type MatriculaParaCamara } from "@/lib/lista-negra";
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

// Lo que la cámara tiene que tener: credenciales en la blanca, lista negra en la negra. Antes
// eran sólo las credenciales, todas a la blanca (ver lib/lista-negra).
async function dbPlateSet(): Promise<Set<string>> {
    return new Set((await matriculasParaCargar()).map((m) => m.plate));
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

    const deseadas = await matriculasParaCargar();
    const byNorm = new Map<string, MatriculaParaCamara>();
    for (const m of deseadas) if (!byNorm.has(m.plate)) byNorm.set(m.plate, m);
    const db = new Set(byNorm.keys());

    let cam: string[] = [];
    try { cam = await driver.getPlates(device); }
    catch (e: any) { return { ok: false, error: "No se pudo leer la cámara: " + (e?.message || ""), added: 0, addFail: 0, removed: 0, remFail: 0 }; }

    const camSet = new Set<string>();
    const camOrig = new Map<string, string>();
    for (const p of cam) { const n = norm(p); if (n) { camSet.add(n); if (!camOrig.has(n)) camOrig.set(n, p); } }

    // Las negras se mandan SIEMPRE, estén o no en la cámara: la lectura de la cámara no dice
    // en qué lista está cada una, y volver a mandar la misma chapa con otro listType la mueve.
    const toAdd = [...db].filter((p) => !camSet.has(p) || byNorm.get(p)?.lista === "blackList");
    const toRemove = [...camSet].filter((p) => !db.has(p));

    let added = 0, addFail = 0, removed = 0, remFail = 0;
    for (const n of toAdd) {
        const m = byNorm.get(n);
        if (!m) continue;
        try { await driver.addPlateToCamera(device, m.plate, m.lista); added++; } catch { addFail++; }
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
    const deseadas = await matriculasParaCargar();
    let before = 0;
    try { before = (await driver.getPlates(device)).length; } catch { }
    try { await driver.clearWhiteList(device); } catch { }
    let added = 0, addFail = 0;
    for (const m of deseadas) { try { await driver.addPlateToCamera(device, m.plate, m.lista); added++; } catch { addFail++; } }
    return { ok: true, added, addFail, removed: before, remFail: 0, before, after: added };
}

/**
 * Buscar un usuario (nombre, matrícula o lote) y ver, cámara por cámara, si sus matrículas
 * están cargadas. Busca cada matrícula en la cámara (no baja la lista entera): es rápido.
 */
export async function buscarUsuarioEnCamaras(q: string) {
    if (!(await getSession())) return { ok: false as const, error: "Hace falta una sesión del panel." };
    const t = String(q || "").trim();
    if (t.length < 2) return { ok: true as const, usuarios: [], camaras: [] };
    const tn = norm(t);
    const usuarios = await prisma.user.findMany({
        where: {
            OR: [
                { name: { contains: t, mode: "insensitive" } },
                ...(tn.length >= 2 ? [{ credentials: { some: { type: "PLATE" as any, value: { contains: tn, mode: "insensitive" as any } } } }] : []),
                { unit: { name: { contains: t, mode: "insensitive" } } },
            ],
        },
        select: { id: true, name: true, role: true, unit: { select: { name: true } }, credentials: { where: { type: "PLATE" as any }, select: { value: true } } },
        take: 6,
    });
    const devices = await prisma.device.findMany({ where: { deviceType: "LPR_CAMERA", brand: "HIKVISION" }, orderBy: { name: "asc" } });
    const driver = new HikvisionDriver();
    const out = [];
    for (const u of usuarios) {
        const plates = [];
        for (const c of u.credentials.slice(0, 6)) {
            const estado: Record<string, string> = {};
            await Promise.all(devices.map(async (d) => {
                try { const h = await driver.findPlateOnCamera(d, c.value); estado[d.id] = h ? h.lista : "falta"; }
                catch { estado[d.id] = "error"; }
            }));
            plates.push({ value: c.value, camaras: estado });
        }
        out.push({ id: u.id, name: u.name, role: String(u.role), lote: u.unit?.name || null, plates });
    }
    return { ok: true as const, usuarios: out, camaras: devices.map((d) => ({ id: d.id, name: d.name, direction: String(d.direction || "") })) };
}

/** Carga en todas las cámaras LPR las matrículas de UN usuario que les falten (lista blanca). */
export async function sincronizarUsuario(userId: string) {
    if (!(await getSession())) return { ok: false as const, error: "Hace falta una sesión del panel.", resultados: [] };
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { credentials: { where: { type: "PLATE" as any }, select: { value: true } } } });
    if (!u) return { ok: false as const, error: "El usuario no existe", resultados: [] };
    const devices = await prisma.device.findMany({ where: { deviceType: "LPR_CAMERA", brand: "HIKVISION" } });
    const driver = new HikvisionDriver();
    const resultados: { deviceId: string; agregadas: number; error?: string }[] = [];
    await Promise.all(devices.map(async (d) => {
        let agregadas = 0;
        try {
            for (const c of u.credentials) {
                const h = await driver.findPlateOnCamera(d, c.value);
                if (!h) { await driver.addPlateToCamera(d, c.value, "whiteList"); agregadas++; }
            }
            resultados.push({ deviceId: d.id, agregadas });
        } catch (e: any) { resultados.push({ deviceId: d.id, agregadas, error: e?.message || "sin conexión" }); }
    }));
    return { ok: true as const, resultados };
}
