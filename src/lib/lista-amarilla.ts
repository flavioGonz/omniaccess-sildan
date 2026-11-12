import { prisma } from "@/lib/prisma";

/**
 * La bitácora de las fichas de la Lista Amarilla, del lado del servidor (openspec
 * seguimiento-lista-amarilla). Las acciones que escriben la lista (actions/watchlist y
 * actions/padron) anotan acá lo que hacen; la pantalla lee y escribe por actions/lista-amarilla.
 */

export type TipoNota = "NOTA" | "ALTA" | "RENOVACION" | "NIVEL" | "BAJA" | "REACTIVACION";

/** Tope de una nota: lo que entra en un párrafo. Más que eso es un informe, y va en otro lado. */
export const NOTA_MAX = 1000;

/**
 * La clave de la ficha a la que pertenece una fila de PlateWatch. Es la misma que arma la
 * pestaña (actions/padron): f:<ficha> | u:<userId> | p:<filaId>.
 */
export function claveDeFila(f: { id: string; ficha?: string | null; userId?: string | null }): string {
    if (f.ficha) return `f:${f.ficha}`;
    if (f.userId) return `u:${f.userId}`;
    return `p:${f.id}`;
}

/** Qué filas de PlateWatch son de una ficha, según su clave. Null si la clave no es de filas (`r:`) o está mal. */
export function dondeDeClave(clave: string): { ficha: string } | { id: string } | { userId: string; ficha: null } | null {
    const tipo = clave.slice(0, 1), id = clave.slice(2);
    if (clave.charAt(1) !== ":" || !id) return null;
    if (tipo === "f") return { ficha: id };
    if (tipo === "p") return { id };
    if (tipo === "u") return { userId: id, ficha: null };
    return null;
}

/**
 * Asentar algo en la bitácora. Nunca tira: un asiento que no se pudo escribir no puede deshacer
 * el alta o la baja que lo originó — queda en el registro del servidor y la acción sigue.
 */
export async function anotar(clave: string, tipo: TipoNota, texto: string, autor: string | null): Promise<void> {
    try {
        await prisma.notaVigilancia.create({ data: { fichaClave: clave, tipo, texto: texto.trim().slice(0, NOTA_MAX), autor: autor || null } });
    } catch (e: any) { console.error(`[lista-amarilla] no se pudo asentar ${tipo} en ${clave}:`, e?.message || e); }
}

/** Si la ficha ya tiene bitácora: es o fue amarilla, y lo que le pase se sigue anotando. */
export async function tieneBitacora(clave: string): Promise<boolean> {
    try { return (await prisma.notaVigilancia.count({ where: { fichaClave: clave } })) > 0; } catch { return false; }
}

/**
 * Mudar la bitácora cuando la ficha cambia de clave. Pasa en UN lugar: al guardar desde la
 * pestaña una matrícula suelta (`p:<filaId>`), que se vuelve ficha (`f:<id>`). Sin esto la
 * historia quedaría colgada de una clave que ya no abre nada.
 */
export async function mudarBitacora(de: string, a: string): Promise<void> {
    if (!de || !a || de === a) return;
    await prisma.notaVigilancia.updateMany({ where: { fichaClave: de }, data: { fichaClave: a } });
}
