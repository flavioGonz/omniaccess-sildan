"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getSession } from "@/app/actions/auth";
import { funcionActiva } from "@/app/actions/funciones";
import { getFichaMatricula } from "@/app/actions/history";
import { normalizeWatchCat } from "@/lib/watch-categories";
import { normalizarMatricula } from "@/lib/lista-negra";
import { proximaRevision, REVISION_DIAS } from "@/lib/padron";
import { anotar, dondeDeClave, NOTA_MAX, type TipoNota } from "@/lib/lista-amarilla";
import { combinarSeguimiento, type ResumenSeguimiento } from "@/lib/seguimiento";

/**
 * El seguimiento de una ficha de la Lista Amarilla (openspec seguimiento-lista-amarilla): su
 * resumen de actividad, su bitácora y la renovación de su fecha de revisión.
 *
 * Todo exige sesión del panel y la función «Lista Amarilla» prendida. Con la función apagada no
 * se lee ni se escribe nada, y lo guardado queda como está para cuando se vuelva a prender.
 */

type Rechazo = { ok: false; error: string; funcionApagada?: true };
const APAGADA: Rechazo = { ok: false, error: "«Lista Amarilla» está apagada en la instalación.", funcionApagada: true };

async function quienSoy(): Promise<string | null> {
    try { const s: any = await getSession(); return (s?.name as string) || (s?.sub as string) || null; } catch { return null; }
}
/** Sesión y función. Devuelve el rechazo, o null si se puede seguir. */
async function puerta(): Promise<Rechazo | null> {
    if (!(await getSession().catch(() => null))) return { ok: false, error: "Sesión vencida: volvé a entrar." };
    if (!(await funcionActiva("LPR_BUSQUEDA"))) return APAGADA;
    return null;
}

// ── Bitácora ──────────────────────────────────────────────────────────────────────────────

export type AsientoBitacora = { id: string; tipo: TipoNota; texto: string; autor: string | null; cuando: string };

/** Los asientos de la ficha, los más nuevos primero. */
export async function bitacoraDe(clave: string): Promise<{ ok: true; asientos: AsientoBitacora[] } | Rechazo> {
    const no = await puerta(); if (no) return no;
    if (!dondeDeClave(clave)) return { ok: false, error: "Esta ficha no lleva bitácora." };
    try {
        const filas = await prisma.notaVigilancia.findMany({ where: { fichaClave: clave }, orderBy: { createdAt: "desc" }, take: 200 });
        return { ok: true, asientos: filas.map((f) => ({ id: f.id, tipo: f.tipo as TipoNota, texto: f.texto, autor: f.autor, cuando: f.createdAt.toISOString() })) };
    } catch (e: any) { return { ok: false, error: e?.message || "No se pudo leer la bitácora." }; }
}

/** Una nota del operador. No se edita ni se borra después: para corregir, se agrega otra. */
export async function anotarEnBitacora(clave: string, texto: string): Promise<{ ok: true; asiento: AsientoBitacora } | Rechazo> {
    const no = await puerta(); if (no) return no;
    const donde = dondeDeClave(clave);
    if (!donde) return { ok: false, error: "Esta ficha no lleva bitácora." };
    const t = String(texto || "").trim();
    if (!t) return { ok: false, error: "La nota está vacía." };
    if (t.length > NOTA_MAX) return { ok: false, error: `La nota es muy larga: ${t.length} caracteres, y entran ${NOTA_MAX}.` };
    try {
        if (!(await prisma.plateWatch.count({ where: donde }))) return { ok: false, error: "La ficha ya no existe." };
        const f = await prisma.notaVigilancia.create({ data: { fichaClave: clave, tipo: "NOTA", texto: t, autor: await quienSoy() } });
        return { ok: true, asiento: { id: f.id, tipo: "NOTA", texto: f.texto, autor: f.autor, cuando: f.createdAt.toISOString() } };
    } catch (e: any) { return { ok: false, error: e?.message || "No se pudo guardar la nota." }; }
}

// ── Revisión ──────────────────────────────────────────────────────────────────────────────

/**
 * Renovar: quien administra la miró y decide seguirla. El plazo vuelve a contar desde hoy
 * (no desde la fecha que tenía: renovar una vencida hace tres semanas no puede dejarla vencida).
 */
export async function renovarRevision(clave: string): Promise<{ ok: true; revisarEl: string } | Rechazo> {
    const no = await puerta(); if (no) return no;
    const donde = dondeDeClave(clave);
    if (!donde) return { ok: false, error: "Esta ficha no se renueva." };
    try {
        const filas = await prisma.plateWatch.findMany({ where: { ...donde, active: true } });
        const amarillas = filas.filter((f) => normalizeWatchCat(f.category) === "SEARCH");
        if (!filas.length) return { ok: false, error: "La ficha está dada de baja: reactivala para seguirla." };
        if (!amarillas.length) return { ok: false, error: "La revisión es de la Lista Amarilla: esta ficha está en lista negra." };
        const revisarEl = proximaRevision();
        await prisma.plateWatch.updateMany({ where: { id: { in: amarillas.map((f) => f.id) } }, data: { revisarEl } });
        await anotar(clave, "RENOVACION", `Revisada: se sigue ${REVISION_DIAS} días más.`, await quienSoy());
        revalidatePath("/admin/users");
        return { ok: true, revisarEl: revisarEl.toISOString() };
    } catch (e: any) { return { ok: false, error: e?.message || "No se pudo renovar." }; }
}

// ── Resumen de actividad ──────────────────────────────────────────────────────────────────

/** Tope de matrículas que se resumen: una ficha con más que esto no es un vehículo, es una flota. */
const TOPE_MATRICULAS = 8;

/**
 * Las cifras de la ficha, sumando sus matrículas. Sale de lo mismo que muestra «Investigar»
 * (getFichaMatricula), a propósito: ver lib/seguimiento.
 */
export async function resumenSeguimiento(clave: string): Promise<{ ok: true; resumen: ResumenSeguimiento } | Rechazo> {
    const no = await puerta(); if (no) return no;
    const donde = dondeDeClave(clave);
    if (!donde) return { ok: false, error: "Esta ficha no tiene seguimiento." };
    try {
        const filas = await prisma.plateWatch.findMany({ where: donde, select: { plate: true, active: true, deactivatedAt: true } });
        // Las vigentes: las activas o, dada de baja, las de la última baja (igual que la pestaña).
        const activas = filas.filter((f) => f.active);
        const ultimaBaja = Math.max(0, ...filas.map((f) => f.deactivatedAt?.getTime() || 0));
        const vigentes = activas.length ? activas : filas.filter((f) => (f.deactivatedAt?.getTime() || 0) === ultimaBaja);
        const chapas = [...new Set(vigentes.map((f) => normalizarMatricula(f.plate)).filter(Boolean))].slice(0, TOPE_MATRICULAS);
        const fichas = (await Promise.all(chapas.map((p) => getFichaMatricula(p)))).filter((f): f is NonNullable<typeof f> => !!f);
        return { ok: true, resumen: combinarSeguimiento(fichas) };
    } catch (e: any) { return { ok: false, error: e?.message || "No se pudo leer el seguimiento." }; }
}
