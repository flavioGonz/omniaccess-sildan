"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { normalizeWatchCat } from "@/lib/watch-categories";

const norm = (p: string) => (p || "").toString().toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function getWatchlist() {
    const rows = await prisma.plateWatch.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map((r) => ({ ...r, category: normalizeWatchCat(r.category) }));
}

export type WatchEntry = { label: string; category: string; color: string | null; source: "manual" | "role" };

/**
 * Mapa {placa → {label, category, color, source}} para el monitor.
 * Incluye: (1) entradas manuales activas del PlateWatch y
 *          (2) auto-derivadas de usuarios con rol BLACKLISTED / WHITELISTED (patente = credencial PLATE).
 * El watch manual tiene prioridad sobre el derivado del rol.
 */
export async function getWatchMap(): Promise<Record<string, WatchEntry>> {
    const out: Record<string, WatchEntry> = {};

    // (2) Auto-derivado del rol del usuario — se carga primero para que el manual lo pueda pisar
    try {
        const roleCreds = await prisma.credential.findMany({
            where: { type: "PLATE", user: { role: { in: ["BLACKLISTED", "WHITELISTED"] as any } } },
            select: { value: true, user: { select: { name: true, role: true } } },
        });
        for (const cr of roleCreds) {
            const plate = norm(cr.value || "");
            if (!plate || !cr.user) continue;
            out[plate] = { label: cr.user.name || "", category: cr.user.role as string, color: null, source: "role" };
        }
    } catch { /* ignore */ }

    // (1) Watchlist manual (pisa el derivado)
    const rows = await prisma.plateWatch.findMany({ where: { active: true }, select: { plate: true, label: true, category: true, color: true } });
    for (const r of rows) out[norm(r.plate)] = { label: r.label, category: normalizeWatchCat(r.category), color: r.color, source: "manual" };

    return out;
}

export async function addWatch(data: { plate: string; label?: string; category?: string; notify?: boolean; color?: string }) {
    const plate = norm(data.plate);
    if (!plate) return { ok: false, error: "Matrícula vacía" };
    const category = normalizeWatchCat(data.category);
    try {
        const row = await prisma.plateWatch.upsert({
            where: { plate },
            create: { plate, label: data.label || "", category, notify: data.notify ?? true, color: data.color || null, active: true },
            update: { label: data.label || "", category, notify: data.notify ?? true, color: data.color || null, active: true },
        });
        revalidatePath("/admin/monitor-lpr");
        return { ok: true, row };
    } catch (e: any) { return { ok: false, error: e?.message }; }
}

export async function updateWatch(id: string, data: { label?: string; category?: string; notify?: boolean; active?: boolean; color?: string }) {
    try {
        const patch: any = { ...data };
        if (data.category !== undefined) patch.category = normalizeWatchCat(data.category);
        const row = await prisma.plateWatch.update({ where: { id }, data: patch });
        revalidatePath("/admin/monitor-lpr");
        return { ok: true, row };
    } catch (e: any) { return { ok: false, error: e?.message }; }
}

export async function deleteWatch(id: string) {
    try {
        await prisma.plateWatch.delete({ where: { id } });
        revalidatePath("/admin/monitor-lpr");
        return { ok: true };
    } catch (e: any) { return { ok: false, error: e?.message }; }
}
