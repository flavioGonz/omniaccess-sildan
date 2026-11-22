/**
 * Compartir por dónde va un rastreador con alguien de afuera: lo que se puede probar sin base.
 *
 * El caso: «el camión sale para allá, seguilo vos». Quien recibe el enlace no tiene usuario ni lo
 * va a tener, así que el enlace ES el permiso. De ahí las tres reglas:
 *  · **vence solo**, y como mucho dura una semana: un enlace que nadie se acuerda de cortar no
 *    puede seguir mostrando dónde está el vehículo un mes después;
 *  · **se puede cortar antes**, y cortado, vencido e inexistente se ven igual desde afuera: no se
 *    le confirma a quien prueba direcciones que alguna vez existió;
 *  · **muestra sólo desde que se compartió**: nunca el historial de antes, ni otros vehículos, ni
 *    la matrícula, el IMEI o la batería.
 */

export const DURACIONES = [
    { horas: 1, rotulo: "1 hora" }, { horas: 4, rotulo: "4 horas" }, { horas: 12, rotulo: "12 horas" },
    { horas: 24, rotulo: "1 día" }, { horas: 72, rotulo: "3 días" }, { horas: 168, rotulo: "7 días" },
] as const;
export const HORAS_MAX = 168;

/** Las horas pedidas, llevadas a algo que se pueda cumplir: entre una y una semana. */
export const horasValidas = (h: unknown): number => Math.min(Math.max(Math.round(Number(h) || 0), 1), HORAS_MAX);

export type EstadoEnlace = "vigente" | "vencido" | "cortado";
export function estadoDeEnlace(e: { venceAt: Date | string; revocadoAt?: Date | string | null }, ahora: Date = new Date()): EstadoEnlace {
    if (e.revocadoAt) return "cortado";
    return new Date(e.venceAt).getTime() > ahora.getTime() ? "vigente" : "vencido";
}

/** «3 h 20 min», «2 días», «menos de un minuto»: cuánto le queda. */
export function quedaLegible(venceAt: Date | string, ahora: Date = new Date()): string {
    const min = Math.floor((new Date(venceAt).getTime() - ahora.getTime()) / 60_000);
    if (min < 1) return "menos de un minuto";
    if (min < 60) return `${min} min`;
    if (min < 48 * 60) { const h = Math.floor(min / 60), m = min % 60; return m && h < 12 ? `${h} h ${m} min` : `${h} h`; }
    return `${Math.round(min / 1440)} días`;
}

/** Lo que ve quien abre el enlace. Nada más que esto sale del servidor sin sesión. */
export type VistaCompartida = {
    nombre: string;
    lat: number | null; lon: number | null; velocidad: number | null; rumbo: number | null;
    /** La hora de esa posición. */
    cuando: string | null;
    /** Si el rastreador está reportando ahora. */
    enLinea: boolean;
    venceAt: string;
    /** El camino desde que se compartió, si quien compartió lo permitió. */
    recorrido: [number, number][];
};
