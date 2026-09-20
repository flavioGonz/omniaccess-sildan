"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { FUNCIONES, funcionPorId, type FuncionId } from "@/lib/funciones";

/**
 * Mismo mecanismo que los módulos: una fila en Setting con "true" o "false".
 *
 * Lo que no es igual es la lectura: `funcionActiva` la usan rutas que corren por CADA
 * lectura de una cámara, y una consulta a la base por cada matrícula leída sería pagar
 * una pregunta de configuración al ritmo del tránsito. Por eso la respuesta se guarda
 * unos segundos. El retardo es el que tarda en notarse un cambio de configuración, que
 * es exactamente el retardo que a nadie le importa.
 */

const VIDA_MS = 10_000;
const cache = new Map<string, { valor: boolean; hasta: number }>();

export async function getFunciones(): Promise<Record<FuncionId, boolean>> {
    const filas = await prisma.setting.findMany({
        where: { key: { in: FUNCIONES.map((f) => f.id) } },
    });
    const salida: Record<string, boolean> = {};
    for (const f of FUNCIONES) {
        const fila = filas.find((s) => s.key === f.id);
        salida[f.id] = fila ? fila.value === "true" : f.porDefecto;
    }
    return salida as Record<FuncionId, boolean>;
}

export async function funcionActiva(id: FuncionId): Promise<boolean> {
    const guardado = cache.get(id);
    if (guardado && guardado.hasta > Date.now()) return guardado.valor;

    const def = funcionPorId(id);
    if (!def) return false;
    let valor = def.porDefecto;
    try {
        const fila = await prisma.setting.findUnique({ where: { key: id } });
        if (fila) valor = fila.value === "true";
    } catch {
        /* Si la base no contesta se usa el valor por defecto. Apagar una función porque
           falló una consulta sería apagar media instalación por un hipo de red. */
    }
    cache.set(id, { valor, hasta: Date.now() + VIDA_MS });
    return valor;
}

export async function toggleFuncion(id: FuncionId, encendida: boolean): Promise<{ ok: boolean }> {
    if (!funcionPorId(id)) return { ok: false };
    await prisma.setting.upsert({
        where: { key: id },
        update: { value: String(encendida) },
        create: { key: id, value: String(encendida) },
    });
    cache.delete(id);
    revalidatePath("/admin/settings");
    revalidatePath("/admin/mapa");
    return { ok: true };
}
