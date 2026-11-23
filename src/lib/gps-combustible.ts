/**
 * El combustible de un vehículo con rastreador OBD (23/11). Sólo la cuenta, para poder probarla.
 *
 * Hay vehículos que le dicen al rastreador cuánto tienen en el tanque y vehículos que no: el primero
 * que se integró —un Mercedes— no contesta ese dato, y Nico pidió «abordar combustible, niveles del
 * tanque». Lo que el equipo sí informa siempre es cuánto QUEMÓ el motor. Con eso y dos cosas que
 * sabe una persona —cuántos litros entran en el tanque y cuándo se lo llenó— se puede ESTIMAR lo que
 * queda: capacidad menos lo quemado desde que se llenó.
 *
 * Es una estimación y se muestra como tal: no sabe de una carga a medias que nadie anotó, ni de
 * combustible que se saque del tanque. Cuando el vehículo informa su nivel, manda ese y no éste.
 */

export type MotorCombustible = { combustible?: number; combustibleL?: number; consumido?: number };
export type DatosTanque = { capacidad: number | null; llenoEn: number | null; llenoCuando: string | null };

export type NivelTanque = {
    /** De dónde sale: lo dice el vehículo, se estima desde la última vez que se llenó, o no se sabe. */
    fuente: "vehiculo" | "estimado" | "sin-dato";
    /** Porcentaje del tanque, de 0 a 100. Null si no se puede decir. */
    pct: number | null;
    /** Litros que quedan. Null si no se puede decir. */
    litros: number | null;
    /** Desde cuándo se viene estimando (la última vez que se marcó «tanque lleno»). */
    desde: string | null;
    /** Qué falta para poder estimarlo, en palabras; null si no falta nada. */
    falta: string | null;
};

const redondo = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export function nivelDelTanque(motor: MotorCombustible | null | undefined, tanque: DatosTanque): NivelTanque {
    const cap = tanque.capacidad && tanque.capacidad > 0 ? tanque.capacidad : null;
    /* Lo que dice el vehículo manda: en porcentaje, o en litros si lo da así. */
    if (motor?.combustible !== undefined) return { fuente: "vehiculo", pct: Math.min(100, motor.combustible), litros: cap ? redondo(cap * motor.combustible / 100) : null, desde: null, falta: null };
    if (motor?.combustibleL !== undefined) return { fuente: "vehiculo", pct: cap ? Math.min(100, Math.round(motor.combustibleL / cap * 100)) : null, litros: motor.combustibleL, desde: null, falta: null };
    if (!cap) return { fuente: "sin-dato", pct: null, litros: null, desde: null, falta: "Cargá cuántos litros entran en el tanque" };
    if (tanque.llenoEn === null || tanque.llenoEn === undefined) return { fuente: "sin-dato", pct: null, litros: null, desde: null, falta: "Marcá «Tanque lleno» la próxima vez que cargues" };
    if (motor?.consumido === undefined) return { fuente: "sin-dato", pct: null, litros: null, desde: tanque.llenoCuando, falta: "El equipo todavía no informó cuánto lleva consumido" };
    /* Un consumido menor que el del llenado es un equipo que se cambió o se reinició: no se estima sobre eso. */
    const quemado = motor.consumido - tanque.llenoEn;
    if (quemado < 0) return { fuente: "sin-dato", pct: null, litros: null, desde: tanque.llenoCuando, falta: "El contador del equipo volvió a empezar: marcá «Tanque lleno» de nuevo" };
    const litros = Math.max(0, redondo(cap - quemado));
    return { fuente: "estimado", pct: Math.round(litros / cap * 100), litros, desde: tanque.llenoCuando, falta: null };
}

/** Por debajo de esto no se da un rendimiento: unos pocos kilómetros regulando dan cualquier número. */
export const KM_MIN_RENDIMIENTO = 20;

/** Litros cada 100 km desde que el equipo está puesto. Null si todavía anduvo poco para decirlo. */
export function rendimiento(consumido: number | null | undefined, km: number | null | undefined): number | null {
    if (consumido === null || consumido === undefined || !km || km < KM_MIN_RENDIMIENTO) return null;
    return redondo(consumido / km * 100);
}
