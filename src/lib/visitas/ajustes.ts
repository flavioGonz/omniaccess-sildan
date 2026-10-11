import { prisma } from "@/lib/prisma";
import { normalizarAjustes, CLAVE_MODO, CLAVE_TIPOS, CLAVE_AVISOS, AJUSTES_POR_DEFECTO, type Ajustes } from "./ajustes-base";

export * from "./ajustes-base";

/**
 * Cuánto se recuerdan los ajustes en memoria. El motor corre en cada lectura (hasta una por
 * segundo en hora pico): ir a `Setting` cada vez sería una consulta por lectura para un dato
 * que cambia una vez por mes. 30 s es lo que tarda, como mucho, un cambio en Ajustes en verse.
 */
const CACHE_MS = 30_000;
let cache: { ajustes: Ajustes; hasta: number } | null = null;

export async function leerAjustesVisitas(fresco = false): Promise<Ajustes> {
    if (!fresco && cache && cache.hasta > Date.now()) return cache.ajustes;
    try {
        const filas = await prisma.setting.findMany({ where: { key: { in: [CLAVE_MODO, CLAVE_TIPOS, CLAVE_AVISOS] } }, select: { key: true, value: true } });
        const v = (k: string) => filas.find((f) => f.key === k)?.value ?? null;
        const ajustes = normalizarAjustes({ modo: v(CLAVE_MODO), tipos: v(CLAVE_TIPOS), avisos: v(CLAVE_AVISOS) });
        cache = { ajustes, hasta: Date.now() + CACHE_MS };
        return ajustes;
    } catch {
        // Sin base no hay visitas que procesar; se devuelve lo de siempre para no romper la lectura.
        return cache?.ajustes || AJUSTES_POR_DEFECTO;
    }
}

/** Después de guardar desde Ajustes: que el próximo uso lea de nuevo. */
export function olvidarAjustesVisitas() { cache = null; }
