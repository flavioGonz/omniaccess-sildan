"use server";

import { revalidatePath } from "next/cache";
import { aplicarModoCamara, capacidadesModo as capacidades, type PedidoModo } from "@/lib/modo-camara-db";

/** El modo de una cámara desde el panel: alta, ficha (lib/modo-camara-db.ts hace el trabajo). */
export async function ponerModoCamara(id: string, pedido: PedidoModo): Promise<{ ok: boolean; error?: string; pendientes: string[] }> {
    const { getSession } = await import("@/app/actions/auth");
    if (!(await getSession())) return { ok: false, error: "Hace falta una sesión del panel.", pendientes: [] };
    const r = await aplicarModoCamara(id, pedido);
    revalidatePath("/admin/devices");
    return r;
}

/** Lo que el servidor tiene prendido para cada modo: la pantalla lo dice al elegir. */
export async function capacidadesModo() {
    const { getSession } = await import("@/app/actions/auth");
    if (!(await getSession())) return null;
    return capacidades();
}
