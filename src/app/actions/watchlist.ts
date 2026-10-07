"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { normalizeWatchCat, type WatchCategory } from "@/lib/watch-categories";
import { getSession } from "@/app/actions/auth";
import {
    aplicarListaNegraEnCamaras, normalizarMatricula, vigilanciaDe,
    type ResultadoCamaras, type OrigenVigilancia,
} from "@/lib/lista-negra";

/**
 * La lista de vigilancia: las acciones que escriben la ÚNICA lista (PlateWatch).
 *
 * Las usan la pestaña de /admin/users, el diálogo del monitor, los interruptores de la ficha del
 * evento y la ficha de la persona. Criterio común, por diseño del cambio lista-negra-unificada:
 *  - la baja DESACTIVA (queda quién, cuándo y por qué); no se borra;
 *  - no se pisa una categoría distinta sin que el que escribe lo confirme (`force`);
 *  - toda entrada o salida de lista negra se aplica en las lectoras y se devuelve qué pasó
 *    con cada cámara, para que la pantalla lo diga en vez de asumir.
 */

const norm = normalizarMatricula;

const PAGINAS = ["/admin/monitor-lpr", "/admin/users", "/admin/history"];
const revalidar = () => PAGINAS.forEach((p) => revalidatePath(p));

async function quienSoy(): Promise<string | null> {
    try { const s: any = await getSession(); return (s?.name as string) || (s?.sub as string) || null; } catch { return null; }
}

export type FilaVigilancia = {
    id: string; plate: string; category: WatchCategory; label: string; motivo: string | null; color: string | null;
    notify: boolean; active: boolean; createdAt: Date; updatedAt: Date; deactivatedAt: Date | null;
    createdBy: string | null; userId: string | null; userName: string | null; unidad: string | null;
    origen: OrigenVigilancia;
};

/** Toda la lista (activas e inactivas), con la persona vinculada, para la pestaña de Usuarios. */
export async function getWatchlist(): Promise<FilaVigilancia[]> {
    const rows = await prisma.plateWatch.findMany({ orderBy: [{ active: "desc" }, { updatedAt: "desc" }] });
    const ids = [...new Set(rows.map((r) => r.userId).filter(Boolean))] as string[];
    const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: { select: { name: true } } } }) : [];
    const porId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => {
        const u = r.userId ? porId.get(r.userId) : null;
        return {
            id: r.id, plate: r.plate, category: normalizeWatchCat(r.category) || "SEARCH", label: r.label, motivo: r.motivo, color: r.color,
            notify: r.notify, active: r.active, createdAt: r.createdAt, updatedAt: r.updatedAt, deactivatedAt: r.deactivatedAt,
            createdBy: r.createdBy, userId: r.userId, userName: u?.name || null, unidad: u?.unit?.name || null,
            origen: r.userId ? "persona" : "manual",
        };
    });
}

/**
 * Las matrículas que están en lista negra SÓLO por el rol del usuario (módulo facial), sin fila
 * propia. Se muestran en la pestaña como "por rol", en sólo lectura: se sacan desde ese módulo.
 */
export async function getNegrasPorRol(): Promise<{ plate: string; userId: string; userName: string; unidad: string | null }[]> {
    const creds = await prisma.credential.findMany({
        where: { type: "PLATE", user: { role: "BLACKLISTED" as any } },
        select: { value: true, user: { select: { id: true, name: true, unit: { select: { name: true } } } } },
    });
    const conFila = new Set((await prisma.plateWatch.findMany({ where: { active: true }, select: { plate: true } })).map((w) => norm(w.plate)));
    const out: { plate: string; userId: string; userName: string; unidad: string | null }[] = [];
    for (const c of creds) {
        const p = norm(c.value);
        if (!p || !c.user || conFila.has(p)) continue;
        out.push({ plate: p, userId: c.user.id, userName: c.user.name, unidad: c.user.unit?.name || null });
    }
    return out;
}

export type WatchEntry = { label: string; category: string; color: string | null; source: "manual" | "role"; motivo?: string | null };

/**
 * Mapa {placa → entrada} para el monitor: filas activas de la lista y, debajo, las derivadas del
 * rol BLACKLISTED (la fila manual pisa a la del rol, igual que CONSULTA_VIGILANCIA).
 */
export async function getWatchMap(): Promise<Record<string, WatchEntry>> {
    const out: Record<string, WatchEntry> = {};
    try {
        const roleCreds = await prisma.credential.findMany({
            where: { type: "PLATE", user: { role: { in: ["BLACKLISTED", "WHITELISTED"] as any } } },
            select: { value: true, user: { select: { name: true, role: true } } },
        });
        for (const cr of roleCreds) {
            const plate = norm(cr.value || "");
            if (!plate || !cr.user) continue;
            out[plate] = { label: cr.user.name || "", category: cr.user.role as string, color: null, source: "role" };
        }
    } catch { /* sin rol derivado no se cae el monitor */ }
    const rows = await prisma.plateWatch.findMany({ where: { active: true }, select: { plate: true, label: true, category: true, color: true, motivo: true } });
    for (const r of rows) {
        const c = normalizeWatchCat(r.category);
        if (!c) continue;
        out[norm(r.plate)] = { label: r.label, category: c, color: r.color, source: "manual", motivo: r.motivo };
    }
    return out;
}

export type ResultadoAlta = {
    ok: boolean; error?: string;
    /** La matrícula ya está activa en OTRA categoría: hace falta `force: true` para pisarla. */
    conflicto?: { category: WatchCategory; label: string; motivo: string | null };
    row?: any;
    camaras?: ResultadoCamaras;
};

/**
 * Alta o cambio de una matrícula en la lista. `createdBy` lo pone la acción (el operador logueado)
 * salvo que venga del bot, que manda el número.
 */
export async function addWatch(data: {
    plate: string; label?: string; category?: string; notify?: boolean; color?: string;
    motivo?: string; userId?: string | null; force?: boolean; createdBy?: string;
}): Promise<ResultadoAlta> {
    const plate = norm(data.plate);
    if (!plate) return { ok: false, error: "Matrícula vacía" };
    const category = normalizeWatchCat(data.category ?? "BLACKLISTED");
    if (!category) return { ok: false, error: `Categoría desconocida: "${data.category}". Vale lista negra, VIP o en búsqueda.` };
    try {
        const previa = await prisma.plateWatch.findUnique({ where: { plate } });
        const categoriaPrevia = previa?.active ? normalizeWatchCat(previa.category) : null;
        if (categoriaPrevia && categoriaPrevia !== category && !data.force) {
            return { ok: false, conflicto: { category: categoriaPrevia, label: previa!.label, motivo: previa!.motivo } };
        }
        const createdBy = data.createdBy || (await quienSoy());
        const comunes = {
            label: data.label ?? previa?.label ?? "", category, notify: data.notify ?? previa?.notify ?? true,
            color: data.color ?? previa?.color ?? null, motivo: data.motivo ?? previa?.motivo ?? null,
            userId: data.userId === undefined ? (previa?.userId ?? null) : data.userId,
            active: true, deactivatedAt: null, createdBy,
        };
        const row = await prisma.plateWatch.upsert({ where: { plate }, create: { plate, ...comunes }, update: comunes });
        // Entró a (o salió de) lista negra: la cámara tiene que saberlo ya.
        const eraNegra = categoriaPrevia === "BLACKLISTED";
        const esNegra = category === "BLACKLISTED";
        const camaras = eraNegra !== esNegra ? await aplicarListaNegraEnCamaras(plate, esNegra) : undefined;
        revalidar();
        return { ok: true, row, camaras };
    } catch (e: any) { return { ok: false, error: e?.message }; }
}

export async function updateWatch(id: string, data: { label?: string; category?: string; notify?: boolean; color?: string; motivo?: string | null }) {
    try {
        const previa = await prisma.plateWatch.findUnique({ where: { id } });
        if (!previa) return { ok: false, error: "La entrada ya no existe" };
        const patch: any = { ...data };
        if (data.category !== undefined) {
            const c = normalizeWatchCat(data.category);
            if (!c) return { ok: false, error: `Categoría desconocida: "${data.category}"` };
            patch.category = c;
        }
        const row = await prisma.plateWatch.update({ where: { id }, data: patch });
        let camaras: ResultadoCamaras | undefined;
        if (previa.active) {
            const eraNegra = normalizeWatchCat(previa.category) === "BLACKLISTED";
            const esNegra = normalizeWatchCat(row.category) === "BLACKLISTED";
            if (eraNegra !== esNegra) camaras = await aplicarListaNegraEnCamaras(row.plate, esNegra);
        }
        revalidar();
        return { ok: true, row, camaras };
    } catch (e: any) { return { ok: false, error: e?.message }; }
}

/** La baja: desactiva, guarda cuándo, y devuelve la cámara a su estado normal. */
export async function deactivateWatch(id: string) {
    try {
        const previa = await prisma.plateWatch.findUnique({ where: { id } });
        if (!previa) return { ok: false, error: "La entrada ya no existe" };
        const row = await prisma.plateWatch.update({ where: { id }, data: { active: false, deactivatedAt: new Date() } });
        const camaras = normalizeWatchCat(previa.category) === "BLACKLISTED" && previa.active
            ? await aplicarListaNegraEnCamaras(previa.plate, false) : undefined;
        revalidar();
        return { ok: true, row, camaras };
    } catch (e: any) { return { ok: false, error: e?.message }; }
}

/** Volver a activar una entrada dada de baja (misma categoría, mismo motivo). */
export async function reactivateWatch(id: string) {
    try {
        const row = await prisma.plateWatch.update({ where: { id }, data: { active: true, deactivatedAt: null } });
        const camaras = normalizeWatchCat(row.category) === "BLACKLISTED" ? await aplicarListaNegraEnCamaras(row.plate, true) : undefined;
        revalidar();
        return { ok: true, row, camaras };
    } catch (e: any) { return { ok: false, error: e?.message }; }
}

/**
 * Compatibilidad: lo que antes borraba ahora desactiva. Se mantiene el nombre para los
 * llamadores viejos, pero ya nadie debería borrar una entrada: la historia vale.
 */
export async function deleteWatch(id: string) { return deactivateWatch(id); }

/** Lo que el monitor y la ficha necesitan saber de UNA matrícula (misma respuesta que la barrera). */
export async function getVigilanciaDePlaca(plate: string) {
    return vigilanciaDe(plate);
}

// ── Personas ───────────────────────────────────────────────────────────────────────────

async function matriculasDe(userId: string): Promise<string[]> {
    const creds = await prisma.credential.findMany({ where: { userId, type: "PLATE" }, select: { value: true } });
    return [...new Set(creds.map((c) => norm(c.value)).filter(Boolean))];
}

/**
 * Marcar a una PERSONA en lista negra = todas sus matrículas, vinculadas a ella, con el motivo.
 * No le cambia el rol: eso es del módulo facial.
 */
export async function marcarPersonaEnListaNegra(userId: string, motivo: string, force = false) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
    if (!user) return { ok: false, error: "La persona no existe" };
    const plates = await matriculasDe(userId);
    if (plates.length === 0) return { ok: false, error: "La persona no tiene matrículas cargadas: no hay qué poner en la lista." };
    const conflictos: string[] = [];
    const camaras: ResultadoCamaras = { ok: [], fallo: [] };
    for (const plate of plates) {
        const r = await addWatch({ plate, category: "BLACKLISTED", label: user.name, motivo, userId, force });
        if (r.conflicto) conflictos.push(`${plate} (${r.conflicto.category})`);
        if (r.camaras) { camaras.ok.push(...r.camaras.ok); camaras.fallo.push(...r.camaras.fallo); }
    }
    revalidar();
    if (conflictos.length && !force) return { ok: false, conflicto: conflictos, error: `Ya están en otra categoría: ${conflictos.join(", ")}. Confirmá para pisarlas.` };
    return { ok: true, plates, camaras };
}

/** Desmarcar: se desactivan SÓLO las entradas vinculadas a la persona; una cargada a mano no se toca. */
export async function desmarcarPersonaEnListaNegra(userId: string) {
    const filas = await prisma.plateWatch.findMany({ where: { userId, active: true, category: "BLACKLISTED" } });
    const camaras: ResultadoCamaras = { ok: [], fallo: [] };
    for (const f of filas) {
        const r = await deactivateWatch(f.id);
        if (r.camaras) { camaras.ok.push(...r.camaras.ok); camaras.fallo.push(...r.camaras.fallo); }
    }
    revalidar();
    return { ok: true, plates: filas.map((f) => f.plate), camaras };
}

/** ¿La persona está marcada? (alguna matrícula activa en lista negra vinculada a ella, o el rol). */
export async function estadoListaNegraDePersona(userId: string) {
    const [fila, user] = await Promise.all([
        prisma.plateWatch.findFirst({ where: { userId, active: true, category: "BLACKLISTED" }, select: { motivo: true, createdBy: true, createdAt: true } }),
        prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    ]);
    return { marcada: !!fila, porRol: String(user?.role) === "BLACKLISTED", motivo: fila?.motivo || null, desde: fila?.createdAt || null, por: fila?.createdBy || null };
}

/**
 * Cuando a una persona marcada se le agrega una matrícula, la matrícula nace en la lista. Lo
 * llama el alta de credencial; si la persona no está marcada no hace nada.
 */
export async function heredarListaNegraSiCorresponde(userId: string, plate: string) {
    const marca = await prisma.plateWatch.findFirst({ where: { userId, active: true, category: "BLACKLISTED" }, select: { motivo: true, label: true } });
    if (!marca) return { ok: true, heredada: false };
    const r = await addWatch({ plate, category: "BLACKLISTED", label: marca.label, motivo: marca.motivo || undefined, userId, force: true });
    return { ok: r.ok, heredada: r.ok, camaras: r.camaras };
}

/** Ids de las personas con alguna matrícula activa en lista negra vinculada a ellas (para el badge de la tabla). */
export async function getPersonasEnListaNegra(): Promise<string[]> {
    const filas = await prisma.plateWatch.findMany({ where: { active: true, category: "BLACKLISTED", userId: { not: null } }, select: { userId: true }, distinct: ["userId"] });
    return filas.map((f) => f.userId!).filter(Boolean);
}
