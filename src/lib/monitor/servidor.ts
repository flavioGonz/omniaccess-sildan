import { verifyApiAuth, unauthorizedResponse, forbiddenResponse, type AuthResult } from "@/lib/api-auth";
import { alcanceCubre, type ClaveVista } from "@/lib/monitor/vistas";

/**
 * La puerta de las rutas /api/monitor/<vista>.
 *
 * Con sesión del panel pasa cualquiera (son lecturas que el panel ya muestra). Con enlace
 * de pantalla, sólo si el alcance de su vista cubre esta ruta — el middleware ya lo mira,
 * pero una ruta no debe confiar en que siempre va a estar detrás del middleware.
 */
export async function autorizarMonitor(ruta: string): Promise<{ auth: AuthResult; error?: undefined } | { auth?: undefined; error: Response }> {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return { error: unauthorizedResponse() };
    if (auth.pantalla && !alcanceCubre(auth.pantalla.vista as ClaveVista, ruta)) return { error: forbiddenResponse("Este enlace de pantalla no abre esta información.") };
    return { auth };
}

/** El día del barrio empieza a la medianoche local del servidor (el CT corre en la zona del barrio). */
export function inicioDelDia(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

export const SIN_CACHE = { "Cache-Control": "no-store" } as const;
