"use server";

import { prisma } from "@/lib/prisma";

/**
 * Cuántas cargas del censo esperan que alguien las mire.
 *
 * Existe para la insignia del menú: la bandeja (/admin/censo) no se mira sola, y una carga sin
 * revisar es una familia esperando que el portón la conozca. Sin el número en el menú, la bandeja
 * se descubre el día que alguien reclama.
 *
 * En ámbar y no en rojo: nada está roto, hay trabajo pendiente.
 */
export async function contarCensoPendiente(): Promise<number> {
    try { return await prisma.solicitudPadron.count({ where: { estado: "pendiente" } }); } catch { return 0; }
}
