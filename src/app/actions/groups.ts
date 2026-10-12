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
                select: { users: true, devices: true }
            }
        },
        orderBy: { name: 'asc' }
    });
}

/** Un grupo con sus integrantes y equipos (ids), para el cajón de edición. */
export async function getAccessGroupDetail(id: string) {
    const g = await prisma.accessGroup.findUnique({
        where: { id },
        select: { id: true, name: true, createdAt: true, users: { select: { id: true } }, devices: { select: { id: true } } },
    });
    if (!g) return null;
    return { id: g.id, name: g.name, createdAt: g.createdAt, userIds: g.users.map((u) => u.id), deviceIds: g.devices.map((d) => d.id) };
}

/**
 * Crear o editar un grupo: nombre, personas y equipos. Reemplaza las listas (set), así lo que
 * se destilda en el cajón sale del grupo.
 */
export async function saveAccessGroup(input: { id?: string | null; name: string; userIds: string[]; deviceIds: string[] }) {
    const name = String(input.name || "").trim().slice(0, 80);
    if (!name) return { success: false, error: "Falta el nombre" };
    const users = (input.userIds || []).map((id) => ({ id: String(id) }));
    const devices = (input.deviceIds || []).map((id) => ({ id: String(id) }));
    try {
        const g = input.id
            ? await prisma.accessGroup.update({ where: { id: input.id }, data: { name, users: { set: users }, devices: { set: devices } } })
            : await prisma.accessGroup.create({ data: { name, users: { connect: users }, devices: { connect: devices } } });
        revalidatePath("/admin/groups");
        return { success: true, id: g.id };
    } catch (e: any) { return { success: false, error: e?.message || "No se pudo guardar" }; }
}
