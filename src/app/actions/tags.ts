"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { estadoDelTag, quitarTagDeLosLectores, sincronizarTag, type Destino } from "@/lib/tags";

/**
 * Las tarjetas RFID.
 *
 * ## Dos cosas que estaban mal de fondo
 *
 * **1. "Sin dueño" se escribía como cadena vacía.** `createTag` sin usuario y `unassignTag`
 * ponían `userId = ""`, que no es el id de nadie. La clave foránea lo rechazaba, el error
 * caía en un `catch` que sólo lo escribía en la consola del servidor, y el botón quedaba
 * sin hacer nada y sin decirlo. Las dos acciones **nunca funcionaron**. Ahora la columna
 * admite nulo y "sin dueño" se escribe como nulo, que es lo que significa.
 *
 * **2. Nada llegaba a los lectores.** Dar de alta un tag escribía una fila y revalidaba la
 * ruta. El `AkuvoxDriver` tiene `syncRfKey` desde siempre y nadie lo llamaba. La pantalla
 * era una lista de tarjetas que no abrían ninguna puerta. Ver `src/lib/tags.ts`.
 *
 * ## Y una de forma, que es la que evita que vuelva a pasar
 *
 * Ninguna acción se traga un error. Todas devuelven `{ ok, error? }` y **la pantalla lo
 * muestra**. Un `catch` que sólo hace `console.error` convierte un fallo en un botón que
 * no hace nada, y eso es indistinguible de un botón roto.
 */

export type Respuesta<T = unknown> = { ok: true; dato?: T } | { ok: false; error: string };

const falla = (e: any, queHacia: string): Respuesta<never> => {
    console.error(`[tags] ${queHacia}:`, e);
    return { ok: false, error: e?.message || `No se pudo ${queHacia}.` };
};

export async function getTags() {
    try {
        return await prisma.credential.findMany({
            where: { type: "TAG" },
            include: { user: { include: { unit: true } } },
            orderBy: { createdAt: "desc" },
        });
    } catch (e) {
        console.error("[tags] leer:", e);
        return [];
    }
}

export async function createTag(data: { value: string; userId?: string | null; notes?: string }): Promise<Respuesta<{ id: string; destinos: Destino[] }>> {
    const valor = (data.value || "").trim();
    if (!valor) return { ok: false, error: "Escribí el número que trae la tarjeta." };

    try {
        /* Un número repetido no es un detalle: dos filas con el mismo código son dos
           personas con la misma llave, y el historial no va a poder decir cuál pasó. */
        const repetido = await prisma.credential.findFirst({ where: { type: "TAG", value: valor } });
        if (repetido) return { ok: false, error: "Ya hay una tarjeta cargada con ese número." };

        const tag = await prisma.credential.create({
            data: {
                type: "TAG",
                value: valor,
                notes: data.notes?.trim() || null,
                // Nulo, no cadena vacía: "todavía de nadie".
                userId: data.userId || null,
            },
        });
        revalidatePath("/admin/rfid");
        return { ok: true, dato: { id: tag.id, destinos: await sincronizarTag(tag.id) } };
    } catch (e) { return falla(e, "crear la tarjeta"); }
}

export async function updateTag(id: string, data: { value?: string; userId?: string | null; notes?: string }): Promise<Respuesta<{ destinos: Destino[] }>> {
    try {
        const valor = data.value?.trim();
        if (valor !== undefined && !valor) return { ok: false, error: "El número no puede quedar vacío." };
        if (valor) {
            const repetido = await prisma.credential.findFirst({
                where: { type: "TAG", value: valor, NOT: { id } },
            });
            if (repetido) return { ok: false, error: "Ya hay otra tarjeta con ese número." };
        }

        await prisma.credential.update({
            where: { id },
            data: {
                ...(valor ? { value: valor } : {}),
                ...(data.notes !== undefined ? { notes: data.notes.trim() || null } : {}),
                ...(data.userId !== undefined ? { userId: data.userId || null } : {}),
            },
        });
        revalidatePath("/admin/rfid");
        return { ok: true, dato: { destinos: await sincronizarTag(id) } };
    } catch (e) { return falla(e, "guardar la tarjeta"); }
}

export async function deleteTag(id: string): Promise<Respuesta> {
    try {
        await quitarTagDeLosLectores(id);
        await prisma.credential.delete({ where: { id } });
        revalidatePath("/admin/rfid");
        return { ok: true };
    } catch (e) { return falla(e, "eliminar la tarjeta"); }
}

export async function assignTag(tagId: string, userId: string): Promise<Respuesta<{ destinos: Destino[] }>> {
    try {
        await prisma.credential.update({ where: { id: tagId }, data: { userId } });
        revalidatePath("/admin/rfid");
        // Recién al tener dueño se manda a los lectores: ver `sincronizarTag`.
        return { ok: true, dato: { destinos: await sincronizarTag(tagId) } };
    } catch (e) { return falla(e, "asignar la tarjeta"); }
}

export async function unassignTag(tagId: string): Promise<Respuesta> {
    try {
        await prisma.credential.update({ where: { id: tagId }, data: { userId: null } });
        await quitarTagDeLosLectores(tagId);
        revalidatePath("/admin/rfid");
        return { ok: true };
    } catch (e) { return falla(e, "desasignar la tarjeta"); }
}

/** Volver a mandarla a todos los lectores, a pedido. */
export async function reenviarTag(tagId: string): Promise<Respuesta<{ destinos: Destino[] }>> {
    try { return { ok: true, dato: { destinos: await sincronizarTag(tagId) } }; }
    catch (e) { return falla(e, "mandar la tarjeta a los lectores"); }
}

export async function destinosDeTag(tagId: string): Promise<Destino[]> {
    try { return await estadoDelTag(tagId); }
    catch (e) { console.error("[tags] estado:", e); return []; }
}

export async function purgeTags(): Promise<Respuesta> {
    try {
        const ids = (await prisma.credential.findMany({ where: { type: "TAG" }, select: { id: true } })).map((c) => c.id);
        await prisma.hardwareMirror.deleteMany({ where: { hardwareId: { in: ids } } }).catch(() => { });
        await prisma.credential.deleteMany({ where: { type: "TAG" } });
        revalidatePath("/admin/rfid");
        return { ok: true };
    } catch (e) { return falla(e, "purgar las tarjetas"); }
}
