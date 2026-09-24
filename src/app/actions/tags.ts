"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { estadoDelTag, quitarTagDeLosLectores, sincronizarTag, type Destino, type QuitadaDe } from "@/lib/tags";

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

/**
 * Borrar la tarjeta. Primero se la saca de los lectores; recién después se la olvida.
 *
 * ── POR QUE NO BORRA A LA FUERZA ────────────────────────────────────────────────────
 *
 * Antes esto llamaba a `quitarTagDeLosLectores`, **descartaba lo que devolvía** y borraba
 * la credencial igual. Hoy esa función sí saca la tarjeta del equipo, pero puede fallar
 * —un portero apagado, sin red, o de una marca que no sabe quitar— y en ese caso borrar
 * la credencial es el peor final posible: la tarjeta sigue abriendo la puerta y se acaba
 * de destruir la última fila que sabía que existe, que es la que permite reintentar.
 *
 * Así que si algún lector la conserva, no se borra y se dice DÓNDE quedó. El operador
 * decide: la saca a mano y reintenta, o la borra igual con `forzar` sabiendo que queda
 * una tarjeta viva sin registro.
 *
 * No es prudencia de más: una tarjeta que no se pudo quitar es, casi siempre, una tarjeta
 * perdida o robada. Es justo el caso en que hay que insistir, no el que hay que tapar.
 */
export async function deleteTag(
    id: string,
    opciones?: { forzar?: boolean },
): Promise<Respuesta<{ quedan: QuitadaDe[] }>> {
    try {
        const salidas = await quitarTagDeLosLectores(id);
        const quedan = salidas.filter((s) => !s.quitada);

        if (quedan.length && !opciones?.forzar) {
            return {
                ok: false,
                error: `La tarjeta sigue cargada en ${quedan.length} `
                    + `${quedan.length === 1 ? "lector" : "lectores"}: `
                    + `${quedan.map((q) => q.nombre).join(", ")}. `
                    + `No se borró para no perder el registro de dónde quedó.`,
            };
        }

        await prisma.credential.delete({ where: { id } });
        revalidatePath("/admin/rfid");
        return { ok: true, dato: { quedan } };
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

export async function unassignTag(tagId: string): Promise<Respuesta<{ quedan: QuitadaDe[] }>> {
    try {
        /* Se saca de los lectores ANTES de quitarle el dueño: `quitarTagDeLosLectores`
           necesita la credencial para identificarla en el equipo, y una tarjeta sin dueño
           que sigue cargada abre igual — es exactamente lo que desasignar quiere evitar. */
        const salidas = await quitarTagDeLosLectores(tagId);
        await prisma.credential.update({ where: { id: tagId }, data: { userId: null } });
        revalidatePath("/admin/rfid");

        const quedan = salidas.filter((s) => !s.quitada);
        /* Desasignar sí se hace igual —el vínculo con la persona es nuestro y se corta—
           pero si la tarjeta quedó en un lector hay que decirlo: sigue abriendo. */
        if (quedan.length) {
            return {
                ok: false,
                error: `Se desasignó, pero la tarjeta sigue cargada en: `
                    + `${quedan.map((q) => q.nombre).join(", ")}. Hasta sacarla de ahí, sigue abriendo.`,
            };
        }
        return { ok: true, dato: { quedan } };
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

/**
 * Borrar TODAS las tarjetas. Deja al barrio entero sin llave.
 *
 * Antes borraba las credenciales y el espejo y nada más: las asignadas seguían cargadas en
 * los porteros y seguían abriendo, y al borrar los `credential.id` se perdía el
 * identificador con el que el lector reconoce cada una — después de purgar no quedaba
 * forma de saber cuáles ir a sacar a mano.
 *
 * Ahora hace lo mismo que el borrado de a una, tarjeta por tarjeta: la saca de cada lector
 * y recién ahí la olvida. Las que no se pudieron quitar **no se borran**, y se informan
 * con nombre. Es más lento y está bien que lo sea: son porteros con un CPU chico y esto es
 * la operación más destructiva de la pantalla.
 */
export async function purgeTags(): Promise<Respuesta<{ borradas: number; quedan: QuitadaDe[] }>> {
    try {
        const tags = await prisma.credential.findMany({ where: { type: "TAG" }, select: { id: true } });

        let borradas = 0;
        const quedan: QuitadaDe[] = [];
        for (const t of tags) {
            const salidas = await quitarTagDeLosLectores(t.id);
            const pendientes = salidas.filter((s) => !s.quitada);
            if (pendientes.length) { quedan.push(...pendientes); continue; }
            await prisma.credential.delete({ where: { id: t.id } }).catch(() => { });
            borradas++;
        }

        revalidatePath("/admin/rfid");
        if (quedan.length) {
            const lectores = [...new Set(quedan.map((q) => q.nombre))];
            return {
                ok: false,
                error: `Se borraron ${borradas} de ${tags.length}. `
                    + `${tags.length - borradas} siguen cargadas y no se borraron, en: ${lectores.join(", ")}.`,
            };
        }
        return { ok: true, dato: { borradas, quedan } };
    } catch (e) { return falla(e, "purgar las tarjetas"); }
}
