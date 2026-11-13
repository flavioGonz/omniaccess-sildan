/**
 * Cuándo se vuelve a probar un vivo que no arrancó, y cuándo el problema no es una cámara.
 *
 * Por qué no un tiempo fijo (13/11, Nico: «la pared queda toda en negro y tengo que recargar»). El
 * fallo se recordaba 5 minutos, pensado para la cámara que no reproduce en este navegador. Pero el
 * caso de todos los días es otro: el servidor de video se queda un minuto sin poder llegar a las
 * cámaras (se cayó el enlace con el sitio) y contesta error a TODOS los vivos a la vez. Cada
 * baldosa probaba directo, después convertido, y quedaba en foto cinco minutos —con las fotos
 * tampoco llegando—: una pared de ruedas girando que nadie espera, así que se recargaba la página.
 *
 * Ahora la primera espera es corta y se duplica cada vez que vuelve a fallar: la pared vuelve sola
 * apenas vuelve el video, y la cámara que de verdad no anda termina probándose cada 5 minutos,
 * como antes. Sin pantalla ni red: lo usan la pared y las pruebas.
 */
export const REINTENTAR_VIVO_MIN_MS = 20_000;
export const REINTENTAR_VIVO_MAX_MS = 5 * 60_000;

/**
 * Cuánto esperar antes de volver a probar, según cuántas veces seguidas falló (1 = la primera).
 * `azar` (0–1) lo corre ±20 %: si fallaron todas juntas, que no vuelvan a pedir todas en el mismo segundo.
 */
export function esperaDeReintento(veces: number, azar = 0.5): number {
    const base = Math.min(REINTENTAR_VIVO_MAX_MS, REINTENTAR_VIVO_MIN_MS * 2 ** Math.max(0, Math.min(10, veces - 1)));
    return Math.round(base * (0.8 + Math.max(0, Math.min(1, azar)) * 0.4));
}

/**
 * A qué hora le toca probar de nuevo a un vivo que falló en `desde`. En un corte general no se
 * espera más que la primera vez por muchas veces que haya fallado: ahí no es que la cámara no
 * ande, es que no se llega a ninguna, y lo que importa es enterarse rápido de que volvió.
 */
export function proximoIntento(f: { desde: number; veces: number; azar: number }, general: boolean): number {
    return f.desde + esperaDeReintento(general ? 1 : f.veces, f.azar);
}

/** Con tantas baldosas sin video a la vez no es una cámara. */
export const CORTE_GENERAL_MIN = 3;
/**
 * ¿Es un corte general? Al menos CORTE_GENERAL_MIN baldosas sin su vivo y, además, la mitad de la
 * pantalla: en una pared de 16 con dos cámaras rotas no se avisa nada; en una de 4 con 3 caídas, sí.
 */
export function esCorteGeneral(sinVideo: number, enPantalla: number): boolean {
    return sinVideo >= CORTE_GENERAL_MIN && sinVideo * 2 >= enPantalla;
}
