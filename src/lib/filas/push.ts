/**
 * Cuándo fue la última noticia de cada cámara de fila por PUSH (la Bosch postea a
 * /api/onvif/notify). Lo leen el sondeo, para no duplicar lecturas mientras el push anda, y la
 * detección de cortes, para no declarar caída una cámara que está mandando eventos.
 *
 * Vivía en la ruta de notify y el sondeo la importaba de ahí. Va en globalThis porque Next puede
 * cargar el módulo una vez por ruta, y entonces cada una veía su propio Map.
 */

/** Sin noticias del push por más de esto, el sondeo vuelve a guardar lecturas. */
export const PUSH_VIGENTE_MS = 60_000;

const g = globalThis as unknown as { __pushFilas?: Map<string, number> };
const actividad: Map<string, number> = (g.__pushFilas ||= new Map());

export function anotarPush(deviceId: string, t = Date.now()) { actividad.set(deviceId, t); }
export function ultimoPush(deviceId: string): number | null { return actividad.get(deviceId) ?? null; }
export function pushVigente(deviceId: string, ahora = Date.now()): boolean {
    const t = actividad.get(deviceId);
    return !!t && ahora - t < PUSH_VIGENTE_MS;
}
export const actividadPush = () => actividad;
