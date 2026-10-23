/**
 * Constantes de las centrales que comparten la API y la pantalla (sin prisma: la pantalla las importa).
 */

/**
 * Supervisión máxima: 7 días. Era 24 h, y una central que llega por un receptor (IPC10) sólo da
 * señales de vida con su prueba periódica, que en Paradox es una por día: con 24 h justas quedaba
 * «Sin supervisión» cada noche que la prueba se atrasaba un minuto.
 */
export const SUPERVISION_MAX = 7 * 86_400;

/** El modelo de equipo de una central que no habla DC-09 sino que llega por la salida a CMS de un receptor. */
export const POR_RECEPTOR = "Por receptor (IPC10 / Sur-Gard)";

/** Puerto TCP de la salida a CMS (alarm-receiver, ALARMAS_PUERTO_CMS). */
export const PUERTO_CMS = 10011;
