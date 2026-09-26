"use server";

import { prisma } from "@/lib/prisma";

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
