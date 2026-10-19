/**
 * ¿Está atendiendo una fila ahora? Lo que comparten el reinicio por horario (schedule/tick), el
 * aviso de fila llena (onvif-polling) y el calendario de Horarios.
 *
 * Los horarios son OPCIONALES (Nico, HB 19/10: «calendarios no obligatorios»): una fila sin
 * ningún horario se considera siempre abierta y avisa a toda hora, como antes. Un día especial
 * (feriado, horario reducido) manda sobre el horario de siempre ese día; el de una fila manda
 * sobre el general.
 *
 * Todo en hora de Montevideo. El cálculo no depende de la zona del servidor (antes UTC, desde el
 * 19/10 el CT de HB está en Montevideo): se resta el desfasaje a mano, como hacía el tick.
 */

/** Uruguay: UTC−3, sin horario de verano. */
export const DESFASAJE_UY_MS = 3 * 60 * 60 * 1000;

export type HorarioFila = { deviceId: string | null; daysOfWeek: string; openTime: string; closeTime: string; enabled: boolean };
export type DiaEspecial = { fecha: string; deviceId: string | null; cerrada: boolean; openTime: string | null; closeTime: string | null };

/** Fecha (AAAA-MM-DD), día de la semana (1 = lunes … 7 = domingo) y hora (HH:MM) en Montevideo. */
export function enMontevideo(t: Date = new Date()) {
    const u = new Date(t.getTime() - DESFASAJE_UY_MS);
    const d = u.getUTCDay();
    return {
        fecha: `${u.getUTCFullYear()}-${String(u.getUTCMonth() + 1).padStart(2, "0")}-${String(u.getUTCDate()).padStart(2, "0")}`,
        dow: d === 0 ? 7 : d,
        hhmm: `${String(u.getUTCHours()).padStart(2, "0")}:${String(u.getUTCMinutes()).padStart(2, "0")}`,
    };
}

export const diasDe = (s: string) => (s || "").split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => n >= 1 && n <= 7);

/** ¿hh:mm cae en [abre, cierra)? Si cierra ≤ abre, el turno pasa la medianoche. */
export function dentro(hhmm: string, abre: string, cierra: string): boolean {
    return cierra > abre ? hhmm >= abre && hhmm < cierra : hhmm >= abre || hhmm < cierra;
}

/** El día especial que rige para esta fila en esa fecha (el de la fila antes que el general). */
export function especialDe(especiales: DiaEspecial[], deviceId: string, fecha: string): DiaEspecial | null {
    const delDia = especiales.filter((e) => e.fecha === fecha);
    return delDia.find((e) => e.deviceId === deviceId) || delDia.find((e) => !e.deviceId) || null;
}

/** Los horarios que le tocan a una fila: los suyos y los generales (sin fila). */
export const horariosDe = (horarios: HorarioFila[], deviceId: string) =>
    horarios.filter((h) => h.enabled && (!h.deviceId || h.deviceId === deviceId));

export function estadoFila(horarios: HorarioFila[], especiales: DiaEspecial[], deviceId: string, t: Date = new Date()):
    { conHorario: boolean; abierta: boolean; motivo: string } {
    const { fecha, dow, hhmm } = enMontevideo(t);
    const esp = especialDe(especiales, deviceId, fecha);
    if (esp) {
        if (esp.cerrada || !esp.openTime || !esp.closeTime) return { conHorario: true, abierta: false, motivo: "día especial: cerrada" };
        return { conHorario: true, abierta: dentro(hhmm, esp.openTime, esp.closeTime), motivo: "día especial" };
    }
    const propios = horariosDe(horarios, deviceId);
    if (!propios.length) return { conHorario: false, abierta: true, motivo: "sin horario" };
    const abierta = propios.some((h) => diasDe(h.daysOfWeek).includes(dow) && dentro(hhmm, h.openTime, h.closeTime));
    return { conHorario: true, abierta, motivo: abierta ? "en horario" : "fuera de horario" };
}
