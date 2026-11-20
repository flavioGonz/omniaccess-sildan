/**
 * Cuándo se puede accionar el relé de un rastreador a distancia.
 *
 * El relé de estos equipos se instala casi siempre para **cortar el combustible o el encendido**.
 * Accionarlo con el vehículo andando lo deja sin motor —y sin dirección asistida ni servofreno—
 * en medio de la calle. Por eso la regla no pregunta «¿tenés permiso?» (eso lo ve la acción),
 * pregunta **«¿sabemos que está detenido?»**, y ante la duda es que no.
 *
 * No hay forma de saltearla desde la pantalla, a propósito. El firmware del equipo suele tener
 * su propia defensa (demora el corte hasta que la velocidad baje), pero es un clon y no está
 * medido: no se apoya la seguridad de una persona en lo que un firmware desconocido dice que hace.
 *
 * SOLTAR el relé no pasa por acá: devolverle el motor a un vehículo nunca es lo peligroso.
 */

export type EstadoParaRele = {
    velocidad: number | null;
    /** De cuándo es la última posición con satélites. */
    cuando: Date | null;
    encendido: boolean | null;
    ultimoLatido: Date | null;
};

/** Una posición más vieja que esto no prueba nada sobre lo que el vehículo hace ahora. */
export const POSICION_FRESCA_MS = 5 * 60_000;
/** Un latido más viejo que esto tampoco: el equipo puede haber arrancado después. */
export const LATIDO_FRESCO_MS = 10 * 60_000;
/** Hasta acá se lo considera detenido (el GPS quieto «camina» un par de km/h). */
export const VELOCIDAD_DETENIDO = 5;

export function puedeAccionarRele(e: EstadoParaRele, ahora = Date.now()): { ok: boolean; motivo?: string } {
    const posFresca = !!e.cuando && ahora - e.cuando.getTime() <= POSICION_FRESCA_MS;
    const latFresco = !!e.ultimoLatido && ahora - e.ultimoLatido.getTime() <= LATIDO_FRESCO_MS;

    if (!latFresco) return { ok: false, motivo: "El rastreador no reporta hace rato: no se sabe qué está haciendo el vehículo." };
    if (posFresca && (e.velocidad || 0) > VELOCIDAD_DETENIDO) return { ok: false, motivo: `El vehículo está en movimiento (${e.velocidad} km/h). El relé no se acciona andando.` };
    /* Con una posición reciente que lo muestra quieto, alcanza: está detenido aunque el motor
       esté en marcha (regulando). */
    if (posFresca) return { ok: true };
    /* Sin posición reciente (bajo techo, sin satélites) sólo queda el motor: apagado, está
       parado; encendido, puede estar andando y no lo podemos ver. */
    if (e.encendido === false) return { ok: true };
    return { ok: false, motivo: "El motor está encendido y no hay una posición reciente que confirme que el vehículo está detenido." };
}

/** Lee lo que el equipo contesta a `RELAY#`: «RELAY : RESUME ,state:0» (medido el 20/11). */
export function leerEstadoRele(texto: string): boolean | null {
    const m = /state\s*:\s*(\d)/i.exec(texto || "");
    return m ? m[1] !== "0" : null;
}
