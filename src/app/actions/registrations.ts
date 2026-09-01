"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function submitRegistrationSuggestion(type: "HOUSE" | "PERSON", data: any, guardName: string) {
    try {
        const suggestion = await prisma.pendingRegistration.create({
            data: {
                type,
                data,
                guardName,
                status: "PENDING"
            }
        });
        revalidatePath("/admin/registrations");
        return { success: true, id: suggestion.id };
    } catch (error) {
        console.error("Error submitting suggestion:", error);
        return { success: false, error: "Error al enviar la sugerencia" };
    }
}

export async function getPendingRegistrations() {
    return await prisma.pendingRegistration.findMany({
        where: {
            status: "PENDING"
        },
        orderBy: {
            createdAt: "desc"
        }
    });
}

export async function updateRegistrationStatus(id: string, status: "APPROVED" | "REJECTED", notes?: string) {
    try {
        const suggestion = await prisma.pendingRegistration.update({
            where: { id },
            data: { 
                status,
                notes
            }
        });

        if (status === "APPROVED") {
            const data = suggestion.data as any;
            if (suggestion.type === "HOUSE") {
                // House suggestion often means a new Unit
                await prisma.unit.create({
                    data: {
                        name: data.name || `Casa ${data.houseNumber}`,
                        houseNumber: data.houseNumber,
                        type: "CASA",
                        address: data.address
                    }
                });
            } else if (suggestion.type === "PERSON") {
                // Person suggestion
                await prisma.user.create({
                    data: {
                        name: data.name,
                        dni: data.dni,
                        phone: data.phone,
                        role: "RESIDENT",
                        unitId: data.unitId
                    }
                });
            }
        }

        revalidatePath("/admin/registrations");
        revalidatePath("/admin/users");
        revalidatePath("/admin/units");
        return { success: true };
    } catch (error) {
        console.error("Error updating registration status:", error);
        return { success: false, error: "Error al procesar la solicitud" };
    }
}
