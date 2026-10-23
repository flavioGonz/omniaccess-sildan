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

/** Lo guardado (o el defecto), sin mirar de qué depende. */
async function guardada(id: FuncionId): Promise<boolean> {
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

/**
 * ¿Está prendida Y se cumple aquello de lo que depende? Es la que usan las rutas: la Gestión de
 * alarmas con la Recepción apagada no hace nada aunque su ajuste diga «true» (se conserva para cuando
 * se vuelva a prender la recepción).
 */
export async function funcionActiva(id: FuncionId): Promise<boolean> {
    const def = funcionPorId(id);
    if (!def) return false;
    if (def.requiere && !(await funcionActiva(def.requiere))) return false;
    return guardada(id);
}

export async function toggleFuncion(id: FuncionId, encendida: boolean): Promise<{ ok: boolean; error?: string }> {
    const def = funcionPorId(id);
    if (!def) return { ok: false };
    // Quién: sesión del panel con permiso de Ajustes (un enlace de pantalla nunca llega acá: el
    // middleware corta todo POST con su cookie, pero una acción no debe confiar en eso).
    const { getSession } = await import("@/app/actions/auth");
    const { permisosDeSesion } = await import("@/lib/permisos");
    const s: any = await getSession().catch(() => null);
    if (!s || !permisosDeSesion(s).includes("ajustes")) return { ok: false, error: "Cambiar funciones pide el permiso Ajustes." };
    if (encendida && def.requiere && !(await funcionActiva(def.requiere))) {
        return { ok: false, error: `Primero hay que prender «${funcionPorId(def.requiere)?.nombre}».` };
    }
    await prisma.setting.upsert({
        where: { key: id },
        update: { value: String(encendida) },
        create: { key: id, value: String(encendida) },
    });
    cache.delete(id);
    // Las que dependen de ésta también cambian su estado efectivo.
    for (const f of FUNCIONES) if (f.requiere === id) cache.delete(f.id);
    if (def.alcance === "instalacion") {
        const { auditar } = await import("@/lib/centrales/sesion");
        await auditar(s, encendida ? "FUNCION_PRENDIDA" : "FUNCION_APAGADA", def.nombre, true, id);
    }
    revalidatePath("/admin/settings");
    revalidatePath("/admin/mapa");
    return { ok: true };
}
