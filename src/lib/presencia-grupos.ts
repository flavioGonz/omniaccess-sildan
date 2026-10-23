import { esPaseLibre } from "@/lib/visitas/ajustes-base";

/**
 * Qué auto adentro va a la pestaña Proveedores de Gestión de alarmas (21/10, Nico: «visitas debe
 * ser una tab, proveedores otra»): los proveedores del padrón, el personal (no es una visita:
 * trabaja acá) y el que entró con un pase libre. El resto de lo registrado es Visitas.
 *
 * Aparte de lib/presencia porque la usan también la pantalla (cliente) y aquel módulo trae Prisma.
 */
export function esDeProveedores(a: { clase: string; tipoVisita: string | null }): boolean {
    return a.clase === "proveedor" || a.clase === "personal" || esPaseLibre(a.tipoVisita);
}
