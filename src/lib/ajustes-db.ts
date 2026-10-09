import { prisma } from "@/lib/prisma";

/**
 * Leer y escribir un `Setting` desde el servidor, sin pasar por la acción.
 *
 * `getSetting`/`updateSetting` de actions/settings son acciones de servidor, o sea que se
 * pueden invocar desde el navegador, y por eso revisan quién llama. El bot de WhatsApp, el
 * receptor de eventos y las rutas internas no tienen sesión: usan estas, que no son
 * invocables desde afuera.
 */
export async function leerAjuste(key: string) {
    try { return await prisma.setting.findUnique({ where: { key } }); } catch { return null; }
}

export async function guardarAjuste(key: string, value: string) {
    return prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}
