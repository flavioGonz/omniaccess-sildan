"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function createAccessGroup(formData: FormData) {
    const name = formData.get("name") as string;
    await prisma.accessGroup.create({
        data: { name },
    });
    revalidatePath("/admin/groups");
}

export async function deleteAccessGroup(id: string) {
    await prisma.accessGroup.delete({ where: { id } });
    revalidatePath("/admin/groups");
}

export async function getAccessGroups() {
    return await prisma.accessGroup.findMany({
        include: {
            _count: {
                select: { users: true }
            }
        },
        orderBy: { name: 'asc' }
    });
}
