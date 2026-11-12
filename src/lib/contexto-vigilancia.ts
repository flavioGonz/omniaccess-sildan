/**
 * El contexto de una lectura de la Lista Amarilla, para el lado de Next. La lógica vive en
 * `lib-contexto-vigilancia.js` (CommonJS) porque la usa también `server.js`, que es quien arma el
 * aviso al leer; acá sólo se le ponen los tipos. Una sola implementación: si hubiera un espejo en
 * TypeScript, tarde o temprano el monitor y el Telegram dirían números distintos.
 */
import type { PrismaClient } from "@prisma/client";

export type ContextoVigilancia = {
    /** Lecturas de los últimos 7 días, contando la de este aviso. */
    lecturas7: number;
    /** En cuántos días distintos (del barrio, no de UTC), contando hoy. */
    dias7: number;
    anterior: { ts: string; camara: string | null } | null;
    /** La línea ya redactada: es la que se muestra y la que se manda. */
    frase: string;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const lib = require("../../lib-contexto-vigilancia.js") as {
    contextoDeLectura: (prisma: PrismaClient, lectura: { plate: string; eventId?: string | null; ahora?: Date }) => Promise<ContextoVigilancia>;
    busquedaPrendida: (prisma: PrismaClient) => Promise<boolean>;
};

export const busquedaPrendida = lib.busquedaPrendida;

/** El contexto de una lectura, o null si no se pudo: quien lo pide muestra el aviso sin la línea. */
export async function contextoDeLectura(prisma: PrismaClient, lectura: { plate: string; eventId?: string | null; ahora?: Date }): Promise<ContextoVigilancia | null> {
    try { return await lib.contextoDeLectura(prisma, lectura); }
    catch (e: any) { console.error("[lista-amarilla] sin contexto:", e?.message || e); return null; }
}
