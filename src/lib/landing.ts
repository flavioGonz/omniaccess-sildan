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
