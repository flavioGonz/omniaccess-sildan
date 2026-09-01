"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export interface BarrioMapData {
    center: [number, number];
    zoom: number;
    perimeter: [number, number][];
    streets: { id: string; name?: string; points: [number, number][] }[];
    cameras: { deviceId: string; lat: number; lng: number }[];
}

const DEFAULT: BarrioMapData = {
    center: [-34.9011, -56.1645],
    zoom: 16,
    perimeter: [],
    streets: [],
    cameras: [],
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
        revalidatePath("/admin/consolas");
        return { ok: true };
    } catch (e: any) {
        console.error("[saveBarrioMap] fallo:", e);
        return { ok: false, error: String(e?.message || e) };
    }
}
