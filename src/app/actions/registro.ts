"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { normalizarMatricula } from "@/lib/lista-negra";
import { watchCatMeta } from "@/lib/watch-categories";

/**
 * Qué sabe ya el sistema de una matrícula, antes de registrarla.
 *
 * El botón «Registrar» del monitor abría directo el alta de una persona. Si la matrícula
 * ya era de alguien, se creaba un duplicado; si ya estaba en vigilancia, nadie lo decía.
 * Esto se consulta al abrir el selector para que la elección se haga sabiendo.
 */
export async function queSeSabeDeMatricula(plate: string): Promise<{
    plate: string;
    duenio: { id: string; nombre: string; rol: string; unidad: string | null } | null;
    vigilancia: { categoria: string; etiqueta: string; motivo: string | null } | null;
}> {
    if (!(await getSession().catch(() => null))) throw new Error("Sesión vencida: volvé a entrar.");
    const p = normalizarMatricula(plate);
    const [veh, cred, watch] = await Promise.all([
        prisma.vehicle.findFirst({ where: { plate: p }, select: { user: { select: { id: true, name: true, role: true, unit: { select: { name: true } } } } } }),
        prisma.credential.findFirst({ where: { type: "PLATE", value: p }, select: { user: { select: { id: true, name: true, role: true, unit: { select: { name: true } } } } } }),
        prisma.plateWatch.findFirst({ where: { plate: p, active: true }, select: { category: true, motivo: true, label: true } }),
    ]);
    const u = veh?.user || cred?.user || null;
    return {
        plate: p,
        duenio: u ? { id: u.id, nombre: u.name, rol: String(u.role), unidad: u.unit?.name || null } : null,
        vigilancia: watch ? { categoria: watch.category, etiqueta: watchCatMeta(watch.category as any).label, motivo: watch.motivo || watch.label || null } : null,
    };
}
