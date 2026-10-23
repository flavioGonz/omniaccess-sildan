/**
 * El color de fondo de las pantallas de pared, con UN criterio para todas (23/10, Nico: «como en
 * las demás, el monitor de alarmas debe ser del color del fondo según el evento; en este caso rojo,
 * similar al que usamos en LPR; esto se debe replicar en los demás monitores; uniforme el criterio
 * de colores de fondo»).
 *
 * Lo inventó Control LPR (traído de Los Olivos, 15/10): con un evento en pantalla, TODA la pared
 * toma su color (MarcoMonitor.setFondo tiñe el fondo y vuelve velos claros a cada panel), así se lee
 * de lejos sin leer nada. Acá queda el criterio, para que rojo signifique lo mismo en todas:
 *
 *  · mal (rojo): algo que atender ya — lectura denegada o en lista negra, alarma crítica de una
 *    central, intrusión sin atender, detección en curso en la pared de cámaras.
 *  · aviso (ámbar): atender pronto o ya tomado — prioridad alta o media, proveedor, intrusión que
 *    alguien está atendiendo.
 *  · bien (verde): pasó y está bien — autorizado.
 *  · visita (violeta): visita.
 *  · info (azul): para saber — prioridad baja.
 *  · null: nada que mirar; la pantalla queda negra como siempre.
 *
 * El color se mezcla con negro para que el texto blanco se lea; lo que tiene que gritar (lista
 * negra, una crítica que nadie tomó) lleva más color.
 */
export const COLOR_FONDO = {
    mal: "rgb(239,68,68)",
    aviso: "rgb(245,158,11)",
    bien: "rgb(16,185,129)",
    visita: "rgb(139,92,246)",
    info: "rgb(59,130,246)",
} as const;
export type TonoFondo = keyof typeof COLOR_FONDO;

/** Cuánto color lleva el fondo (el resto es negro). */
export const MEZCLA_FONDO = { normal: 62, fuerte: 72 } as const;

/** El fondo de la pared para un tono, o null (sin teñir). */
export const fondoDe = (tono: TonoFondo | null | undefined, fuerte = false): string | null =>
    tono ? `color-mix(in oklab, ${COLOR_FONDO[tono]} ${fuerte ? MEZCLA_FONDO.fuerte : MEZCLA_FONDO.normal}%, #050505)` : null;
