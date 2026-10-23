/**
 * A qué pantalla entra el usuario según el modo activo del sistema.
 *
 * Es la misma que abre "Monitor en Vivo" en el menú: si esto y el sidebar se
 * separan, al entrar caés en una pantalla y el primer ítem del menú te lleva a
 * otra. Por eso la decisión vive acá y los dos la usan.
 */
export function pantallaInicio(modules: { MODULE_QUEUE?: boolean; MODULE_FACE?: boolean; MODULE_LPR?: boolean }): string {
    if (modules.MODULE_QUEUE) return "/admin/monitor-queue";
    if (modules.MODULE_FACE) return "/admin/monitor-face";
    if (modules.MODULE_LPR) return "/admin/monitor-lpr";
    return "/admin/dashboard";   // sin ningún modo activo: el panel general
}

import { puedeAbrir } from "@/lib/permisos";

/** Si el monitor del modo no le toca a su rol, la primera de éstas que pueda abrir. */
const ALTERNATIVAS = ["/admin/alarmas", "/admin/monitor-cctv", "/admin/monitor-intrusion", "/admin/history", "/admin/bitacora", "/admin/visitas",
    "/admin/invitados", "/admin/users", "/admin/devices", "/admin/vision", "/admin/filas", "/admin/settings"];

/**
 * La pantalla de inicio para un rol (openspec roles-y-permisos): la del modo si la puede abrir;
 * si no, la primera que pueda. Un operador de monitoreo sin LPR caía en «sin permiso» al entrar.
 */
export function inicioPara(modules: Parameters<typeof pantallaInicio>[0], permisos: string[]): string {
    const modo = pantallaInicio(modules);
    if (puedeAbrir(permisos, modo)) return modo;
    return ALTERNATIVAS.find((r) => puedeAbrir(permisos, r)) || "/admin/dashboard";
}
