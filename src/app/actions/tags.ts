"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function getTags() {
    try {
        const tags = await prisma.credential.findMany({
            where: {
                type: "TAG"
            },
            include: {
                user: {
                    include: {
                        unit: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        return tags;
    } catch (error) {
        console.error("Error fetching tags:", error);
        return [];
    }
}

export async function createTag(data: { value: string; userId?: string }) {
    try {
        const tag = await prisma.credential.create({
            data: {
                type: "TAG",
                value: data.value,
                userId: data.userId || ""
            }
        });
        revalidatePath("/admin/rfid");
        return { success: true, tag };
    } catch (error) {
        console.error("Error creating tag:", error);
        return { success: false, error: "Error al crear el tag" };
    }
}

export async function updateTag(id: string, data: { value?: string; userId?: string }) {
    try {
        const tag = await prisma.credential.update({
            where: { id },
            data: {
                ...(data.value && { value: data.value }),
                ...(data.userId !== undefined && { userId: data.userId })
            }
        });
        revalidatePath("/admin/rfid");
        return { success: true, tag };
    } catch (error) {
        console.error("Error updating tag:", error);
        return { success: false, error: "Error al actualizar el tag" };
    }
}

export async function deleteTag(id: string) {
    try {
        await prisma.credential.delete({
            where: { id }
        });
        revalidatePath("/admin/rfid");
        return { success: true };
    } catch (error) {
        console.error("Error deleting tag:", error);
        return { success: false, error: "Error al eliminar el tag" };
    }
}

export async function assignTag(tagId: string, userId: string) {
    try {
        await prisma.credential.update({
            where: { id: tagId },
            data: { userId }
        });
        revalidatePath("/admin/rfid");
        return { success: true };
    } catch (error) {
        console.error("Error assigning tag:", error);
        return { success: false, error: "Error al asignar el tag" };
    }
}

export async function unassignTag(tagId: string) {
    try {
        await prisma.credential.update({
            where: { id: tagId },
            data: { userId: "" }
        });
        revalidatePath("/admin/rfid");
        return { success: true };
    } catch (error) {
        console.error("Error unassigning tag:", error);
        return { success: false, error: "Error al desasignar el tag" };
    }
}

export async function purgeTags() {
    try {
        await prisma.credential.deleteMany({
            where: {
                type: "TAG"
            }
        });
        revalidatePath("/admin/rfid");
        return { success: true };
    } catch (error) {
        console.error("Error purging tags:", error);
        return { success: false, error: "Error al purgar los tags" };
    }
}
