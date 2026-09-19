"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export interface BarrioMapData {
    center: [number, number];
    zoom: number;
    perimeter: [number, number][];
    streets: { id: string; name?: string; points: [number, number][] }[];
    cameras: { deviceId: string; lat: number; lng: number }[];
    /**
     * Lotes: el contorno de cada casa.
     *
     * `unitId` lo ata a una unidad del padrón y `parkingSlotId` a una plaza del
     * estacionamiento. Son dos cosas distintas y por eso son dos campos: una casa puede
     * tener cochera en otro lado del barrio, y una plaza puede estar asignada sin que
     * nadie haya dibujado todavía el lote.
     */
    lots?: {
        id: string;
        label: string;
        unitId?: string | null;
        parkingSlotId?: string | null;
        points: [number, number][];
    }[];
    /** Capa de fondo con la que abre el mapa: Híbrido, Táctico, Satélite o Calles. */
    base?: string;
    /**
     * Si el mapa abre en la vista 3D, y con qué inclinación y giro.
     *
     * Va aparte de `base` porque la 3D no es una capa de fondo más: es otro motor de
     * mapa. Guardar solo `base` hacía que "Guardar" en 3D pareciera no hacer nada —
     * guardaba, pero la última capa plana, y al volver el mapa abría en plano.
     */
    tresD?: boolean;
    pitch?: number;
    bearing?: number;
}

const DEFAULT: BarrioMapData = {
    center: [-34.9011, -56.1645],
    zoom: 16,
    perimeter: [],
    streets: [],
    cameras: [],
    lots: [],
    base: "Híbrido",
    tresD: false,
    pitch: 55,
    bearing: -20,
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
            lots: Array.isArray(d.lots) ? d.lots : [],
            base: typeof d.base === "string" ? d.base : DEFAULT.base,
            tresD: d.tresD === true,
            pitch: typeof d.pitch === "number" ? d.pitch : DEFAULT.pitch,
            bearing: typeof d.bearing === "number" ? d.bearing : DEFAULT.bearing,
        };
    } catch {
        return DEFAULT;
    }
}

/**
 * Guardar el mapa, y decir QUÉ se guardó.
 *
 * Antes devolvía `{ ok: true }` y nada más, y la pantalla anunciaba "Mapa guardado". Eso
 * confirma que la escritura no falló — que es otra cosa que confirmar que se guardó lo que
 * el operador dibujó. Si el dibujo no llega hasta acá, la pantalla igual dice que salió
 * bien, y el problema aparece recién la próxima vez que alguien abre el mapa.
 *
 * Ahora devuelve la cuenta de lo que efectivamente quedó escrito, leída del objeto que se
 * serializó. La pantalla la muestra. Un "guardado · 0 lotes" cuando se acaba de dibujar uno
 * es un error que se ve en el momento, no dos días después.
 */
export async function saveBarrioMap(data: BarrioMapData): Promise<{
    ok: boolean;
    error?: string;
    guardado?: { lotes: number; calles: number; camaras: number; perimetro: number };
}> {
    try {
        const guardado = {
            lotes: (data.lots || []).length,
            calles: (data.streets || []).length,
            camaras: (data.cameras || []).length,
            perimetro: (data.perimeter || []).length,
        };
        console.log("[saveBarrioMap] llega:", JSON.stringify(guardado));
        await prisma.setting.upsert({
            where: { key: "BARRIO_MAP" },
            update: { value: JSON.stringify(data) },
            create: { key: "BARRIO_MAP", value: JSON.stringify(data) },
        });
        /*
         * El mapa se mira desde dos lados y antes sólo se refrescaba uno. La consola de
         * guardia usa el mismo dibujo que /admin/mapa, así que guardar desde el editor
         * dejaba la consola con el plano viejo hasta que alguien recargara a mano.
         */
        revalidatePath("/admin/consolas");
        revalidatePath("/admin/mapa");
        return { ok: true, guardado };
    } catch (e: any) {
        console.error("[saveBarrioMap] fallo:", e);
        return { ok: false, error: String(e?.message || e) };
    }
}

/**
 * Atar (o soltar) un lote dibujado a una unidad del padrón.
 *
 * Existe para que la pantalla de unidades no tenga que traerse el mapa entero, cambiarle un
 * campo y volver a mandarlo: eso son dos viajes con todo el dibujo adentro, y entre el
 * primero y el segundo cualquiera pudo haber movido una cámara — que se perdería en el
 * camino sin que nadie se entere. Acá se lee y se escribe en el mismo lugar, y lo único que
 * cambia es la atadura.
 *
 * Un lote pertenece a UNA unidad: asignarlo a otra lo suelta de la anterior. Si no fuera
 * así, dos unidades podrían decir que son la misma casa, y el mapa tendría que elegir cuál
 * dibujar.
 */
export async function asignarLoteAUnidad(loteId: string | null, unitId: string) {
    try {
        const row = await prisma.setting.findUnique({ where: { key: "BARRIO_MAP" } });
        if (!row?.value) return { ok: false, error: "Todavía no hay un mapa guardado." };
        const d = JSON.parse(row.value);
        const lots = Array.isArray(d.lots) ? d.lots : [];

        const nuevos = lots.map((l: any) => {
            if (l.unitId === unitId) return { ...l, unitId: null };   // soltar el anterior
            return l;
        }).map((l: any) => (loteId && l.id === loteId ? { ...l, unitId } : l));

        await prisma.setting.update({
            where: { key: "BARRIO_MAP" },
            data: { value: JSON.stringify({ ...d, lots: nuevos }) },
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

/** Los lotes dibujados, para pantallas que sólo necesitan la lista. */
export async function getLotes(): Promise<{ id: string; label: string; unitId?: string | null; parkingSlotId?: string | null; points: [number, number][] }[]> {
    const d = await getBarrioMap();
    return (d.lots || []) as any;
}
