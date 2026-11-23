/**
 * Qué permiso alcanza para cada cosa del rastreo GPS (23/11).
 *
 * El GPS nació dentro de Dispositivos y pedía sus dos permisos: «Dispositivos» para mirar y
 * «Editar dispositivos» para todo lo demás, incluido cortar un motor. Al pasar a tener su menú
 * (Gestión GPS) tuvo los suyos, por dos razones:
 *  · un encargado de flota tiene que poder ver sus camionetas sin que se le abran las cámaras, y
 *  · cortar un motor no puede venir de regalo con «cambiarle el nombre a un rastreador».
 *
 * Cada renglón dice qué permisos valen, y **alcanza con uno**. El de Dispositivos sigue en la lista
 * a propósito: los roles que ya administraban rastreadores no pierden nada el día del cambio.
 *
 * Lo usan las acciones (para exigirlo), el middleware (lib/permisos-acciones) y la pantalla (para
 * no ofrecer un botón que el servidor va a rechazar). No importa nada de servidor.
 */
export const PUEDE_GPS = {
    /** Mirar: vehículos, recorridos, eventos, zonas, reportes en pantalla. */
    ver: ["gps", "dispositivos"],
    /** Preguntarle al equipo y bajar los reportes. */
    operar: ["gps.operar", "dispositivos"],
    /** Darle a alguien de afuera un enlace para seguir un vehículo. */
    compartir: ["gps.operar", "dispositivos.editar"],
    /** Zonas, límites, horarios, nombre y vehículo, y los comandos que cambian cómo reporta el equipo. */
    config: ["gps.config", "dispositivos.editar"],
    /** El relé: cortar y devolver el motor. */
    rele: ["gps.rele", "dispositivos.editar"],
    /**
     * Lo del aparato: darlo de alta, la puerta del receptor, y los comandos que lo pueden dejar sin
     * hablar con este servidor (cambiarle el servidor o la red, reiniciarlo, volverlo de fábrica).
     * Es trabajo de quien instala, no de quien administra la flota.
     */
    equipo: ["dispositivos.editar"],
} as const;
export type QueGps = keyof typeof PUEDE_GPS;

export const puedeGps = (permisos: readonly string[] | null | undefined, que: QueGps): boolean =>
    !!permisos && PUEDE_GPS[que].some((k) => permisos.includes(k));
