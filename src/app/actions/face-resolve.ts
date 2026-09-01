"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function resolveFaceEventAction(
    eventId: string,
    comment: string,
    guardName: string = "Admin Sentinel",
    userName?: string,
    userDni?: string,
    userUnit?: string
) {
    try {
        const event = await prisma.accessEvent.findUnique({
            where: { id: eventId },
            include: {
                user: {
                    include: { unit: true }
                }
            }
        });

        if (!event) return { success: false, error: "Event not found" };

        // Create or update bitacora entry
        await prisma.bitacora.upsert({
            where: { accessEventId: eventId },
            create: {
                accessEventId: eventId,
                notes: comment,
                guardName: guardName,
                timestamp: new Date(),
                type: event.direction === 'EXIT' ? 'EXIT' : 'ENTRY',
                name: userName || event.user?.name || "Sujeto Desconocido",
                dni: userDni || event.user?.dni || "---",
                destination: userUnit || event.user?.unit?.name || null
            },
            update: {
                notes: comment,
                guardName: guardName,
                name: userName || event.user?.name || "Sujeto Desconocido",
                dni: userDni || event.user?.dni || "---",
                destination: userUnit || event.user?.unit?.name || null
            }
        });

        revalidatePath("/admin/dashboard-face");
        return { success: true };
    } catch (error) {
        console.error("Error resolving face event:", error);
        return { success: false, error: "Database error" };
    }
}
