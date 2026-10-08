"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

/**
 * Los equipos que tiene sentido poner en un grupo: los que deciden si alguien pasa.
 * Un NVR o una cámara común no abren nada; ofrecerlos haría creer que el grupo les da permiso.
 */
const TIPOS_QUE_ABREN = ["LPR_CAMERA", "LPR_INTERIOR", "FACE_TERMINAL", "ACCESS_CONTROL", "DOOR_INTERCOM"] as const;

/** Un nombre de grupo más largo que esto ya no entra en una píldora de la ficha de la persona. */
const NOMBRE_MAX = 60;

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
            // `devices` faltaba: la columna "Dispositivos" de la tabla decía 0 siempre,
            // tuviera los equipos que tuviera.
            _count: { select: { users: true, devices: true } },
        },
        orderBy: { name: 'asc' }
    });
}

/** Lo que el cajón necesita para elegir: los equipos que abren y la gente. */
export async function datosParaGrupo() {
    const [equipos, personas] = await Promise.all([
        prisma.device.findMany({
            where: { deviceType: { in: TIPOS_QUE_ABREN as any } },
            select: { id: true, name: true, deviceType: true, direction: true, location: true },
            orderBy: { name: "asc" },
        }),
        // Quien está en lista negra no se ofrece: darle un permiso de paso contradice la lista.
        prisma.user.findMany({
            where: { role: { not: "BLACKLISTED" as any } },
            select: { id: true, name: true, role: true, unit: { select: { name: true } } },
            orderBy: { name: "asc" },
        }),
    ]);
    return {
        equipos,
        personas: personas.map((p) => ({ id: p.id, name: p.name, role: p.role as string, unidad: p.unit?.name || null })),
    };
}

export async function getGrupo(id: string) {
    const g = await prisma.accessGroup.findUnique({
        where: { id },
        select: { id: true, name: true, createdAt: true, updatedAt: true, devices: { select: { id: true } }, users: { select: { id: true } } },
    });
    if (!g) return null;
    return { id: g.id, name: g.name, createdAt: g.createdAt, updatedAt: g.updatedAt, equipos: g.devices.map((d) => d.id), personas: g.users.map((u) => u.id) };
}

/**
 * Crear o editar un grupo con sus equipos y su gente, de una vez.
 *
 * `set` y no `connect`: lo que se manda es la lista completa. Con `connect` sacar a alguien
 * del cajón no lo sacaba del grupo.
 */
export async function guardarGrupo(d: { id?: string | null; name: string; equipos: string[]; personas: string[] }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    try {
        const name = String(d.name || "").trim();
        if (!name) return { ok: false, error: "El grupo necesita un nombre." };
        if (name.length > NOMBRE_MAX) return { ok: false, error: `El nombre es muy largo (máximo ${NOMBRE_MAX}).` };
        const repetido = await prisma.accessGroup.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(d.id ? { NOT: { id: d.id } } : {}) }, select: { id: true } });
        if (repetido) return { ok: false, error: `Ya hay un grupo que se llama «${name}».` };

        const equipos = [...new Set(d.equipos || [])].map((id) => ({ id }));
        const personas = [...new Set(d.personas || [])].map((id) => ({ id }));
        const g = d.id
            ? await prisma.accessGroup.update({ where: { id: d.id }, data: { name, devices: { set: equipos }, users: { set: personas } } })
            : await prisma.accessGroup.create({ data: { name, devices: { connect: equipos }, users: { connect: personas } } });
        revalidatePath("/admin/groups");
        return { ok: true, id: g.id };
    } catch (e: any) {
        return { ok: false, error: e?.message || "No se pudo guardar el grupo." };
    }
}
