"use server";

import { prisma } from "@/lib/prisma";
import { Prisma, Vehicle } from "@prisma/client";
import { revalidatePath } from "next/cache";

/**
 * El padrón de vehículos, con la última vez que el barrio vio cada chapa.
 *
 * Tres cosas se corrigieron acá:
 *
 *   **La última lectura se buscaba sólo en `AccessEvent`** — los pasos por barrera. Pero el
 *   seguimiento interior escribe en `PlateSighting`, y en los barrios donde casi todo viene
 *   de cámaras de calle eso dejaba la columna «última detección» vacía para todos los
 *   vehículos, y sin foto. No era que no se los hubiera visto: era que se los estaba
 *   buscando en la tabla equivocada. Ahora se preguntan las dos y gana la más reciente.
 *
 *   **Las matrículas se pegaban a mano dentro del SQL**, escapando comillas por las
 *   nuestras. Venían de la base, así que no había una inyección real — pero el escape a
 *   mano es una que se rompe la primera vez que alguien reusa el bloque con datos de
 *   afuera. Ahora van como parámetros.
 *
 *   **Los `catch` se tragaban el fallo y devolvían la lista vacía.** Una consulta caída y un
 *   padrón sin vehículos daban exactamente la misma pantalla, y de una se espera mientras
 *   que de la otra se reintenta. Ahora el error sube y la tabla lo muestra.
 */
export async function getVehicles(skip: number = 0, take: number = 20, query?: string) {
    try {
        const where = query ? {
            OR: [
                { plate: { contains: query.toUpperCase() } },
                { brand: { contains: query, mode: 'insensitive' as any } },
                { model: { contains: query, mode: 'insensitive' as any } },
                { user: { name: { contains: query, mode: 'insensitive' as any } } },
            ]
        } : {};

        const [vehicles, total] = await Promise.all([
            prisma.vehicle.findMany({
                where,
                include: { user: true },
                orderBy: { createdAt: "desc" },
                skip,
                take,
                distinct: ['id'],
            }),
            prisma.vehicle.count({ where })
        ]);

        const placas = (vehicles as any[])
            .map(v => String(v.plate || "").toUpperCase())
            .filter(Boolean);

        const ultimas: Record<string, { vista: Date; foto: string | null }> = {};
        if (placas.length > 0) {
            // Las dos fuentes de lectura en una sola pasada. `PlateSighting.plate` se
            // guarda ya normalizada en mayúsculas en todos los caminos de escritura, así
            // que se compara directo y el índice (plate, timestamp) sirve; `plateDetected`
            // de `AccessEvent` es historia vieja y no lo está, por eso ahí va el UPPER().
            //
            // La foto no es la de la última lectura sino la de la última lectura *que tenga
            // foto*: un vehículo leído recién por una cámara sin snapshot no debería perder
            // el cuadro que sí se guardó ayer.
            const filas: any[] = await prisma.$queryRaw(Prisma.sql`
                WITH lecturas AS (
                    SELECT UPPER("plateDetected") AS plate, "timestamp" AS t, "snapshotPath" AS foto
                      FROM "AccessEvent"
                     WHERE UPPER("plateDetected") IN (${Prisma.join(placas)})
                    UNION ALL
                    SELECT "plate" AS plate, "timestamp" AS t, "snapshotUrl" AS foto
                      FROM "PlateSighting"
                     WHERE "plate" IN (${Prisma.join(placas)})
                )
                SELECT plate,
                       MAX(t) AS vista,
                       (ARRAY_AGG(foto ORDER BY t DESC)
                          FILTER (WHERE foto IS NOT NULL AND foto <> ''))[1] AS foto
                  FROM lecturas
                 GROUP BY plate
            `);
            for (const f of filas) {
                ultimas[f.plate] = { vista: f.vista, foto: f.foto ?? null };
            }
        }

        const enriched = (vehicles as any[]).map(v => {
            const u = ultimas[String(v.plate || "").toUpperCase()];
            return { ...v, lastPhoto: u?.foto ?? null, lastSeen: u?.vista ?? null };
        });
        return { vehicles: enriched, total, error: null as string | null };
    } catch (error: any) {
        console.error("Error fetching vehicles:", error);
        return { vehicles: [], total: 0, error: error?.message || "No se pudo consultar el padrón" };
    }
}

export async function createVehicle(data: any) {
    try {
        const vehicle = await prisma.vehicle.create({
            data: {
                plate: data.plate.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                brand: data.brand,
                model: data.model,
                color: data.color,
                type: data.type || "SEDAN",
                notes: data.notes,
                userId: data.userId,
            },
        });

        // Also create a credential for this plate if it doesn't exist
        const credentialExists = await prisma.credential.findFirst({
            where: { value: vehicle.plate, type: "PLATE" }
        });

        if (!credentialExists) {
            await prisma.credential.create({
                data: {
                    type: "PLATE",
                    value: vehicle.plate,
                    userId: data.userId,
                }
            });
        }

        revalidatePath("/admin/vehicles");
        return { success: true, vehicle };
    } catch (error: any) {
        console.error("Error creating vehicle:", error);
        return { success: false, error: error.message };
    }
}

export async function updateVehicle(id: string, data: any) {
    try {
        const vehicle = await prisma.vehicle.update({
            where: { id },
            data: {
                plate: data.plate.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                brand: data.brand,
                model: data.model,
                color: data.color,
                type: data.type,
                notes: data.notes,
                userId: data.userId,
            },
        });
        revalidatePath("/admin/vehicles");
        return { success: true, vehicle };
    } catch (error: any) {
        console.error("Error updating vehicle:", error);
        return { success: false, error: error.message };
    }
}

export async function deleteVehicle(id: string) {
    try {
        await prisma.vehicle.delete({
            where: { id },
        });
        revalidatePath("/admin/vehicles");
        return { success: true };
    } catch (error: any) {
        console.error("Error deleting vehicle:", error);
        return { success: false, error: error.message };
    }
}

export async function getVehicleHistory(plate: string) {
    try {
        const events = await prisma.accessEvent.findMany({
            where: {
                OR: [
                    { plateDetected: plate },
                    { plateNumber: plate }
                ]
            },
            include: {
                device: true,
                user: true
            },
            orderBy: {
                timestamp: "desc"
            },
            take: 50
        });
        return { success: true, events };
    } catch (error: any) {
        console.error("Error fetching vehicle history:", error);
        return { success: false, error: error.message, events: [] };
    }
}
