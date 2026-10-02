"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export interface BarrioMapData {
    center: [number, number];
    zoom: number;
    perimeter: [number, number][];
    streets: { id: string; name?: string; points: [number, number][] }[];
    cameras: { deviceId: string; lat: number; lng: number; rumbo?: number | null; size?: number; color?: string }[];
    lotes: { id: string; name?: string; points: [number, number][]; parkingSlotId?: string }[];
    divisions: { id: string; tipo: string; points: [number, number][]; color?: string; weight?: number }[];
}

const DEFAULT: BarrioMapData = {
    center: [-34.9011, -56.1645],
    zoom: 16,
    perimeter: [],
    streets: [],
    cameras: [],
    lotes: [],
    divisions: [],
};

export async function getBarrioMap(): Promise<BarrioMapData> {
    try {
        const row = await prisma.setting.findUnique({ where: { key: "BARRIO_MAP" } });
        if (!row?.value) return DEFAULT;
        const d = JSON.parse(row.value);
        return {
            center: Array.isArray(d.center) ? d.center : DEFAULT.center,
            zoom: typeof d.zoom === "number" ? d.zoom : DEFAULT.zoom,
            perimeter: Array.isArray(d.perimeter) ? d.perimeter : [],
            streets: Array.isArray(d.streets) ? d.streets : [],
            cameras: Array.isArray(d.cameras) ? d.cameras : [],
            lotes: Array.isArray(d.lotes) ? d.lotes : [],
            divisions: Array.isArray(d.divisions) ? d.divisions : [],
        };
    } catch {
        return DEFAULT;
    }
}

export async function saveBarrioMap(data: BarrioMapData): Promise<{ ok: boolean; error?: string }> {
    try {
        await prisma.setting.upsert({
            where: { key: "BARRIO_MAP" },
            update: { value: JSON.stringify(data) },
            create: { key: "BARRIO_MAP", value: JSON.stringify(data) },
        });
        return { ok: true };
    } catch (e: any) {
        console.error("[saveBarrioMap] fallo:", e);
        return { ok: false, error: String(e?.message || e) };
    }
}

// ── Vínculo lote↔unidad (portado de San Nicolás) ───────────────────────────
// San Nicolás vincula cada lote del mapa con una UNIDAD; Olivos los vincula con una
// PLAZA. Al traer el mapa de Olivos gana su modelo (los lotes viven en `lotes`), pero
// no se pierde el vínculo con unidades: estas dos funciones operan sobre `lotes`
// (con respaldo al viejo `lots`) y conservan el campo `unitId` en la misma entrada.
export async function getLotes(): Promise<{ id: string; label: string; unitId?: string | null; parkingSlotId?: string | null; points: [number, number][] }[]> {
    const d: any = await getBarrioMap();
    const arr = (d.lotes || d.lots || []) as any[];
    return arr.map((l) => ({
        id: l.id,
        label: l.label || l.name || l.id,
        unitId: l.unitId ?? null,
        parkingSlotId: l.parkingSlotId ?? null,
        points: l.points || [],
    }));
}

export async function asignarLoteAUnidad(loteId: string | null, unitId: string) {
    try {
        const row = await prisma.setting.findUnique({ where: { key: "BARRIO_MAP" } });
        if (!row?.value) return { ok: false, error: "Todavía no hay un mapa guardado." };
        const d = JSON.parse(row.value);
        const key = Array.isArray(d.lotes) ? "lotes" : "lots"; // modelo de Olivos primero
        const arr = Array.isArray(d[key]) ? d[key] : [];
        const nuevos = arr
            .map((l: any) => (l.unitId === unitId ? { ...l, unitId: null } : l))   // soltar el anterior
            .map((l: any) => (loteId && l.id === loteId ? { ...l, unitId } : l));
        await prisma.setting.update({
            where: { key: "BARRIO_MAP" },
            data: { value: JSON.stringify({ ...d, [key]: nuevos }) },
        });
        revalidatePath("/admin/mapa");
        revalidatePath("/admin/units");
        revalidatePath("/admin/consolas");
        return { ok: true };
    } catch (e: any) {
        console.error("[asignarLoteAUnidad] fallo:", e);
        return { ok: false, error: String(e?.message || e) };
    }
}
